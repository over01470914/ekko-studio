import { randomUUID } from 'node:crypto'
import { getDb } from '../infrastructure/database'
import { KANBAN_SESSION_NOTIFICATIONS_TABLE as N, KANBAN_SESSION_SUBSCRIPTIONS_TABLE as S } from '../infrastructure/database/schemas'

export interface KanbanSessionSubscription {
  id: number; user_id: number; profile: string; session_id: string; board: string; task_id: string
  cursor: number; active: number; wake_enabled: number; last_wake_at: number; state_event_id: number
  last_error: string | null; created_at: number; updated_at: number
}
export interface KanbanSessionNotification {
  id: number; subscription_id: number; event_id: number; kind: string; label: string; summary: string
  actor: 'kanban/native'; occurred_at: number; status: 'delivered'; delivered_at: number
  wake_status: 'none' | 'pending' | 'leased' | 'queued' | 'suppressed' | 'exhausted'
  attempts: number; next_attempt_at: number; lease_until: number; queue_id: string | null; last_error: string | null
}
function db() { const connection = getDb(); if (!connection) throw new Error('kanban_notification_storage_unavailable'); return connection }
function transaction<T>(fn: () => T): T {
  const connection = db(); connection.exec('BEGIN IMMEDIATE')
  try { const result = fn(); connection.exec('COMMIT'); return result }
  catch (error) { connection.exec('ROLLBACK'); throw error }
}
export function listKanbanSessionSubscriptions(sessionId?: string, userId?: number): KanbanSessionSubscription[] {
  return (sessionId !== undefined && userId !== undefined
    ? db().prepare(`SELECT * FROM ${S} WHERE session_id = ? AND user_id = ? ORDER BY id`).all(sessionId, userId)
    : db().prepare(`SELECT * FROM ${S} WHERE active = 1 ORDER BY id`).all()) as unknown as KanbanSessionSubscription[]
}
export function getKanbanSessionSubscription(id: number): KanbanSessionSubscription | null {
  return db().prepare(`SELECT * FROM ${S} WHERE id = ?`).get(id) as unknown as KanbanSessionSubscription || null
}
export function putKanbanSessionSubscription(input: {
  userId: number; profile: string; sessionId: string; board: string; taskId: string; cursor: number; wakeEnabled?: boolean
}): KanbanSessionSubscription {
  return transaction(() => {
    const old = db().prepare(`SELECT * FROM ${S} WHERE user_id = ? AND session_id = ? AND board = ? AND task_id = ?`)
      .get(input.userId, input.sessionId, input.board, input.taskId) as unknown as KanbanSessionSubscription | undefined
    const now = Date.now()
    // Duplicate POST/automatic binding never skips unprocessed events or resets cooldown/attempts.
    db().prepare(`INSERT INTO ${S} (user_id, profile, session_id, board, task_id, cursor, wake_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, session_id, board, task_id) DO UPDATE SET
      active = 1, wake_enabled = excluded.wake_enabled, cursor = CASE WHEN active = 1 THEN cursor ELSE excluded.cursor END,
      last_error = NULL, updated_at = excluded.updated_at`)
      .run(input.userId, input.profile, input.sessionId, input.board, input.taskId, input.cursor, Number(input.wakeEnabled === true), now, now)
    const row = db().prepare(`SELECT * FROM ${S} WHERE user_id = ? AND session_id = ? AND board = ? AND task_id = ?`)
      .get(input.userId, input.sessionId, input.board, input.taskId) as unknown as KanbanSessionSubscription
    if (old && (!old.active || !input.wakeEnabled)) suppressKanbanWake(row.id)
    return row
  })
}
export function suppressKanbanWake(subscriptionId: number): void {
  db().prepare(`UPDATE ${N} SET wake_status = 'suppressed', lease_until = 0 WHERE subscription_id = ? AND wake_status IN ('pending','leased')`).run(subscriptionId)
}
export function deactivateKanbanSessionSubscription(id: number, error: string | null = null): void {
  transaction(() => {
    db().prepare(`UPDATE ${S} SET active = 0, last_error = ?, updated_at = ? WHERE id = ?`).run(error, Date.now(), id)
    suppressKanbanWake(id)
  })
}
export function setKanbanSubscriptionError(id: number, error: string | null): void {
  db().prepare(`UPDATE ${S} SET last_error = ?, updated_at = ? WHERE id = ? AND active = 1`).run(error, Date.now(), id)
}
/** One batch and cursor commit together; crash cannot lose a staged diagnostic. */
export function advanceKanbanSubscription(id: number, events: Array<{
  id: number; kind: string; occurred_at: number; state: boolean
  notice: { label: string; summary: string; wake: boolean } | null
}>, graceMs: number): void {
  transaction(() => {
    const current = getKanbanSessionSubscription(id)
    if (!current?.active) return
    let cursor = current.cursor, stateId = current.state_event_id
    for (const event of events) {
      if (event.id <= cursor) continue
      if (event.notice) db().prepare(`INSERT OR IGNORE INTO ${N}
        (subscription_id, event_id, kind, label, summary, occurred_at, delivered_at, wake_status, next_attempt_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, event.id, event.kind, event.notice.label, event.notice.summary,
        event.occurred_at, Date.now(), event.notice.wake && current.wake_enabled ? 'pending' : 'none',
        Math.max(Date.now(), event.occurred_at * 1000 + graceMs))
      cursor = event.id
      if (event.state) stateId = event.id
    }
    db().prepare(`UPDATE ${S} SET cursor = ?, state_event_id = ?, updated_at = ? WHERE id = ?`).run(cursor, stateId, Date.now(), id)
  })
}
export function pendingKanbanNotifications(subscriptionId: number): KanbanSessionNotification[] {
  return db().prepare(`SELECT * FROM ${N} WHERE subscription_id = ? AND wake_status IN ('pending','leased') ORDER BY event_id`).all(subscriptionId) as unknown as KanbanSessionNotification[]
}
export function suppressKanbanNotification(id: number): void {
  db().prepare(`UPDATE ${N} SET wake_status = 'suppressed', lease_until = 0 WHERE id = ? AND wake_status IN ('pending','leased')`).run(id)
}
/** Atomic attempt lease acquired BEFORE calling the queue. Retry keeps the same queue identity. */
export function claimKanbanWake(subscriptionId: number, now: number, cooldownMs: number, leaseMs: number, maxAttempts: number): KanbanSessionNotification[] {
  return transaction(() => {
    const sub = getKanbanSessionSubscription(subscriptionId)
    if (!sub?.active || !sub.wake_enabled) return []
    const pending = pendingKanbanNotifications(subscriptionId)
    if (pending.some(n => n.wake_status === 'leased' && n.lease_until > now)) return []
    for (const n of pending) if (n.attempts >= maxAttempts) db().prepare(`UPDATE ${N} SET wake_status = 'exhausted', lease_until = 0 WHERE id = ?`).run(n.id)
    if (sub.last_wake_at > 0 && sub.last_wake_at + cooldownMs > now) return []
    const available = pending.filter(n => n.attempts < maxAttempts && n.next_attempt_at <= now)
    if (!available.length) return []
    const retry = available.find(n => n.queue_id)
    const queueId = retry?.queue_id || `kanban-diagnostic:${randomUUID()}`
    const batch = retry ? available.filter(n => n.queue_id === queueId) : available.filter(n => !n.queue_id)
    for (const n of batch) db().prepare(`UPDATE ${N} SET wake_status = 'leased', attempts = attempts + 1,
      lease_until = ?, next_attempt_at = ?, queue_id = ? WHERE id = ?`).run(now + leaseMs, now + leaseMs, queueId, n.id)
    return batch.map(n => ({ ...n, wake_status: 'leased' as const, attempts: n.attempts + 1, lease_until: now + leaseMs, queue_id: queueId }))
  })
}
export function finishKanbanWake(subscriptionId: number, queueId: string, accepted: boolean, now: number, maxAttempts: number, leaseUntil: number): void {
  transaction(() => {
    const result = db().prepare(`UPDATE ${N} SET wake_status = CASE WHEN ? THEN 'queued' WHEN attempts >= ? THEN 'exhausted' ELSE 'pending' END,
      lease_until = 0, last_error = CASE WHEN ? THEN NULL ELSE 'wake_queue_failed' END
      WHERE subscription_id = ? AND queue_id = ? AND wake_status = 'leased' AND lease_until = ?`).run(Number(accepted), maxAttempts, Number(accepted), subscriptionId, queueId, leaseUntil)
    if (!result.changes) return
    if (accepted) db().prepare(`UPDATE ${S} SET last_wake_at = ?, last_error = NULL WHERE id = ?`).run(now, subscriptionId)
    else setKanbanSubscriptionError(subscriptionId, 'wake_queue_failed')
  })
}
export function listKanbanSessionNotifications(sessionId: string, userId: number, profile: string): Array<KanbanSessionNotification & { board: string; task_id: string }> {
  return db().prepare(`SELECT n.*, s.board, s.task_id FROM ${N} n JOIN ${S} s ON s.id = n.subscription_id
    WHERE s.session_id = ? AND s.user_id = ? AND s.profile = ? ORDER BY n.occurred_at DESC, n.id DESC LIMIT 100`)
    .all(sessionId, userId, profile) as unknown as Array<KanbanSessionNotification & { board: string; task_id: string }>
}

/** Exact durable lookup. Never use the UI's last-100 pagination to authorize a queued request. */
export function hasKanbanDiagnosticEvidence(subscriptionId: number, queueId: string, eventIds: number[]): boolean {
  const ids=[...new Set(eventIds)]
  if(!ids.length || ids.length>100 || ids.some(id=>!Number.isSafeInteger(id)||id<1))return false
  const row=db().prepare(`SELECT COUNT(*) AS count FROM ${N} WHERE subscription_id=? AND queue_id=?
    AND wake_status IN ('pending','leased','queued') AND event_id IN (${ids.map(()=>'?').join(',')})`)
    .get(subscriptionId,queueId,...ids) as {count:number}
  return row.count===ids.length
}
