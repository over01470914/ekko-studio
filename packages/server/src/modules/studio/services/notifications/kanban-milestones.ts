import { isBuiltinEkkoAgent } from '../../contracts/history-source'
import { getSession } from '../../repositories/session-store'
import { findUserById, userCanAccessProfile, type UserRecord } from '../../repositories/users-store'
import {
  advanceKanbanSubscription, claimKanbanWake, deactivateKanbanSessionSubscription, finishKanbanWake,
  getKanbanSessionSubscription, listKanbanSessionNotifications, listKanbanSessionSubscriptions,
  pendingKanbanNotifications, putKanbanSessionSubscription, setKanbanSubscriptionError,
  suppressKanbanNotification, suppressKanbanWake, type KanbanSessionSubscription,
} from '../../repositories/kanban-session-notifications-store'
import {
  kanbanPlainText, kanbanPolicy, kanbanRecovered, kanbanStateEvent,
  KANBAN_WAKE_COOLDOWN_MS, KANBAN_WAKE_GRACE_MS, KANBAN_WAKE_LEASE_MS, KANBAN_WAKE_MAX_ATTEMPTS,
  type KanbanMilestoneEvent, type KanbanTaskRef,
} from './kanban-policy'
export type { KanbanMilestoneEvent, KanbanTaskRef } from './kanban-policy'
export interface KanbanBoardRef { slug: string; archived: boolean; db_path?: string }
export interface KanbanMilestoneSource {
  listBoards(): Promise<KanbanBoardRef[]>
  getTask(taskId: string, board: string): Promise<KanbanTaskRef | { task: KanbanTaskRef } | null>
  latestEventId(board: KanbanBoardRef, taskId: string): number
  /** Ordered, bounded page; timestamps are Unix seconds. */
  events(board: KanbanBoardRef, taskId: string, afterId: number): KanbanMilestoneEvent[]
}
export interface KanbanDiagnosticWake {
  sessionId: string; profile: string; userId: number; queueId: string; eventIds: number[]
  board: string; taskId: string; kind: string; summary: string
}
/** Diagnostic-only normal queue enqueue. Must dedupe queueId durably; true means accepted, not executed. */
export type KanbanWakePort = (input: KanbanDiagnosticWake) => Promise<boolean>
export class KanbanMilestoneError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code) }
}
type UserActor = Pick<UserRecord, 'id'>
function sessionAccess(user: UserActor, sessionId: string, profile: string): boolean {
  const session = getSession(sessionId)
  return findUserById(user.id)?.status === 'active' && session?.user_id != null
    && String(session.user_id) === String(user.id) && (session.profile || 'default') === profile
    && userCanAccessProfile(user.id, profile)
}
function taskAccess(user: UserActor, task: KanbanTaskRef | null, taskId: string): task is KanbanTaskRef {
  return findUserById(user.id)?.status === 'active' && task?.id === taskId
    && !!task.assignee && userCanAccessProfile(user.id, task.assignee)
}
function unwrap(detail: KanbanTaskRef | { task: KanbanTaskRef } | null): KanbanTaskRef | null {
  return detail && 'task' in detail ? detail.task : detail
}
export function createKanbanMilestoneService(source: KanbanMilestoneSource, wakePort?: KanbanWakePort) {
  async function verifiedBoardTask(user: UserActor, boardSlug: string, taskId: string) {
    const board = (await source.listBoards()).find(b => b.slug === boardSlug && !b.archived)
    if (!board) throw new KanbanMilestoneError(404, 'kanban_board_unavailable')
    const task = unwrap(await source.getTask(taskId, boardSlug))
    if (!taskAccess(user, task, taskId)) throw new KanbanMilestoneError(403, 'kanban_task_forbidden')
    return { board, task }
  }
  function requireSession(user: UserActor, sessionId: string, profile: string) {
    if (!sessionAccess(user, sessionId, profile)) throw new KanbanMilestoneError(403, 'session_forbidden')
  }
  async function subscribe(user: UserActor, input: {
    sessionId: string; profile: string; board: string; taskId: string; wakeEnabled?: boolean
    /** Trusted internal creation binding only: cursor before the native created event. Not exposed by HTTP. */
    startCursor?: number
  }) {
    requireSession(user, input.sessionId, input.profile)
    if (input.wakeEnabled && !wakePort) throw new KanbanMilestoneError(409, 'kanban_diagnostics_disabled')
    const targetAgent = getSession(input.sessionId)?.agent
    if (input.wakeEnabled && !isBuiltinEkkoAgent(targetAgent || ''))
      throw new KanbanMilestoneError(400, 'kanban_awake_unsupported_runtime')
    if (!input.board.trim() || !input.taskId.trim() || (input.startCursor !== undefined
      && (!Number.isSafeInteger(input.startCursor) || input.startCursor < 0))) throw new KanbanMilestoneError(400, 'invalid_kanban_subscription')
    const { board, task } = await verifiedBoardTask(user, input.board, input.taskId)
    requireSession(user, input.sessionId, input.profile)
    if (!taskAccess(user, task, input.taskId)) throw new KanbanMilestoneError(403, 'kanban_task_forbidden')
    const cursor = input.startCursor ?? source.latestEventId(board, input.taskId)
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('invalid_native_cursor')
    return putKanbanSessionSubscription({ userId: user.id, ...input, cursor })
  }
  async function list(user: UserActor, sessionId: string, profile: string) {
    requireSession(user, sessionId, profile)
    const subscriptions = listKanbanSessionSubscriptions(sessionId, user.id).filter(s => s.profile === profile)
    const authorized = new Set<number>()
    for (const sub of subscriptions) {
      try { await verifiedBoardTask(user, sub.board, sub.task_id); authorized.add(sub.id) }
      catch (error) {
        if (!(error instanceof KanbanMilestoneError)) throw error
        deactivateKanbanSessionSubscription(sub.id, 'authorization_revoked')
      }
    }
    requireSession(user, sessionId, profile)
    return {
      subscriptions: subscriptions.map(s => {
        const current = getKanbanSessionSubscription(s.id)!
        return { id: s.id, board: s.board, task_id: s.task_id, active: Boolean(current.active),
          wake_enabled: Boolean(current.wake_enabled), last_error: current.last_error, created_at: s.created_at, updated_at: current.updated_at }
      }),
      notifications: listKanbanSessionNotifications(sessionId, user.id, profile).filter(n => authorized.has(n.subscription_id))
        .map(n => ({ id: n.id, board: n.board, task_id: n.task_id, event_id: n.event_id, kind: n.kind,
          label: n.label, summary: n.summary, actor: n.actor, occurred_at: n.occurred_at, wake_status: n.wake_status })),
    }
  }
  function unsubscribe(user: UserActor, sessionId: string, profile: string, subscriptionId: number) {
    requireSession(user, sessionId, profile)
    const sub = getKanbanSessionSubscription(subscriptionId)
    if (!sub || sub.user_id !== user.id || sub.session_id !== sessionId || sub.profile !== profile)
      throw new KanbanMilestoneError(404, 'subscription_not_found')
    deactivateKanbanSessionSubscription(sub.id)
  }
  async function pollSubscription(sub: KanbanSessionSubscription) {
    const user = findUserById(sub.user_id)
    if (!user || !sessionAccess(user, sub.session_id, sub.profile)) {
      deactivateKanbanSessionSubscription(sub.id, 'authorization_revoked'); return
    }
    let verified: Awaited<ReturnType<typeof verifiedBoardTask>>
    try { verified = await verifiedBoardTask(user, sub.board, sub.task_id) }
    catch (error) {
      if (!(error instanceof KanbanMilestoneError)) throw error
      deactivateKanbanSessionSubscription(sub.id, 'authorization_revoked'); return
    }
    if (!sessionAccess(user, sub.session_id, sub.profile)) {
      deactivateKanbanSessionSubscription(sub.id, 'authorization_revoked'); return
    }
    const current = getKanbanSessionSubscription(sub.id)
    if (!current?.active) return
    // Read new state BEFORE retrying outbox diagnostics; completion can supersede a pending lease.
    const events = source.events(verified.board, sub.task_id, current.cursor)
      .filter(e => Number.isSafeInteger(e.id) && e.id > current.cursor && Number.isFinite(e.occurred_at) && e.occurred_at >= 0)
      .sort((a, b) => a.id - b.id)
    advanceKanbanSubscription(sub.id, events.map(e => {
      const notice = kanbanPolicy(e, verified.task)
      return { ...e, state: kanbanStateEvent(e) && !notice?.wake, notice }
    }), KANBAN_WAKE_GRACE_MS)
    setKanbanSubscriptionError(sub.id, null)
    if (!wakePort) return
    let fresh = getKanbanSessionSubscription(sub.id)
    if (!fresh?.active || !fresh.wake_enabled) { suppressKanbanWake(sub.id); return }
    // If a source page is incomplete, defer wakes until we've seen the newest state.
    if (source.latestEventId(verified.board, sub.task_id) > fresh.cursor) return
    // Re-read task and all authorizations immediately before crossing the queue boundary.
    const task = unwrap(await source.getTask(sub.task_id, sub.board))
    if (!sessionAccess(user, sub.session_id, sub.profile) || !taskAccess(user, task, sub.task_id)) {
      deactivateKanbanSessionSubscription(sub.id, 'authorization_revoked'); return
    }
    fresh = getKanbanSessionSubscription(sub.id)
    if (!fresh?.active || !fresh.wake_enabled) { suppressKanbanWake(sub.id); return }
    for (const n of pendingKanbanNotifications(sub.id)) {
      if (kanbanRecovered(task) || n.event_id < fresh.state_event_id
        || task.block_kind === 'needs_input' || task.block_kind === 'dependency' || task.block_kind === 'transient')
        suppressKanbanNotification(n.id)
    }
    const batch = claimKanbanWake(sub.id, Date.now(), KANBAN_WAKE_COOLDOWN_MS, KANBAN_WAKE_LEASE_MS, KANBAN_WAKE_MAX_ATTEMPTS)
    if (!batch.length) return
    const queueId = batch[0].queue_id!
    const last = batch[batch.length - 1]
    // Native text remains explicitly untrusted diagnostic evidence, never an action plan.
    const summary = kanbanPlainText(batch.map(n => `${n.label}${n.summary ? `: ${n.summary}` : ''}`).join('; '), 1200)
    let accepted = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    try { accepted = await Promise.race([wakePort({ sessionId: sub.session_id, profile: sub.profile, userId: sub.user_id,
      queueId, eventIds: batch.map(n => n.event_id), board: sub.board, taskId: sub.task_id,
      kind: last.kind, summary: `Diagnostic only. Untrusted native task evidence: ${summary}` }),
      new Promise<boolean>(resolve => { timeout = setTimeout(() => resolve(false), 30_000); timeout.unref?.() }),
    ]) === true }
    catch { /* Durable lease remains retryable; queueId handles ambiguous acceptance. */ }
    finally { if (timeout) clearTimeout(timeout) }
    finishKanbanWake(sub.id, queueId, accepted, Date.now(), KANBAN_WAKE_MAX_ATTEMPTS, batch[0].lease_until)
  }
  let polling = false
  async function pollOnce() {
    if (polling) return
    polling = true
    try {
      for (const sub of listKanbanSessionSubscriptions()) {
        try { await pollSubscription(sub) }
        catch { setKanbanSubscriptionError(sub.id, 'source_unavailable') }
      }
    } finally { polling = false }
  }
  return { subscribe, list, unsubscribe, pollOnce, diagnosticsEnabled: Boolean(wakePort) }
}
export type KanbanMilestoneService = ReturnType<typeof createKanbanMilestoneService>
let activeService: KanbanMilestoneService | null = null
export function kanbanReportingCapabilities() {
  return { enabled: activeService !== null, diagnosticsEnabled: activeService?.diagnosticsEnabled === true }
}
export function setKanbanMilestoneService(service: KanbanMilestoneService | null) { activeService = service }
export function getKanbanMilestoneService(): KanbanMilestoneService {
  if (!activeService) throw new KanbanMilestoneError(503, 'kanban_milestones_unavailable')
  return activeService
}
