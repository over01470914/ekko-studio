import { randomUUID } from 'node:crypto'
import { getDb } from '../infrastructure/database'
import { KANBAN_DIAGNOSTIC_RUNS_TABLE as TABLE, KANBAN_DIAGNOSTIC_ADMISSIONS_TABLE as ADMISSIONS } from '../infrastructure/database/schemas'
import type { KanbanDiagnosticWake } from '../services/notifications/kanban-milestones'
function db() { const db = getDb(); if (!db) throw new Error('kanban_diagnostic_storage_unavailable'); return db }
export function persistKanbanDiagnostic(input: KanbanDiagnosticWake): boolean {
  const now = Date.now()
  db().prepare(`INSERT OR IGNORE INTO ${TABLE} (queue_id,payload_json,created_at,updated_at) VALUES (?,?,?,?)`)
    .run(input.queueId, JSON.stringify(input), now, now)
  return true
}
export function pendingKanbanDiagnostics(): KanbanDiagnosticWake[] {
  return (db().prepare(`SELECT payload_json FROM ${TABLE} WHERE status = 'pending' AND next_attempt_at <= ? AND attempts < 3 ORDER BY created_at LIMIT 20`)
    .all(Date.now()) as Array<{payload_json:string}>).flatMap(row => {
      try { return [JSON.parse(row.payload_json) as KanbanDiagnosticWake] } catch { return [] }
    })
}
/** Check without reserving: avoid queue/page churn while the global budget is occupied. */
export function canStartKanbanDiagnostic(): boolean {
  const connection = db()
  const active = connection.prepare(`SELECT COUNT(*) AS count FROM ${ADMISSIONS} WHERE status='running'`).get() as { count: number }
  const used = connection.prepare(`SELECT COALESCE(SUM(tokens),0) AS tokens FROM ${ADMISSIONS} WHERE reserved_at > ?`).get(Date.now() - 3_600_000) as { tokens: number }
  return active.count === 0 && used.tokens + 8192 <= 32768
}
export function deferKanbanDiagnostic(queueId: string): void {
  db().prepare(`UPDATE ${TABLE} SET next_attempt_at=?, updated_at=? WHERE queue_id=? AND status='pending'`)
    .run(Date.now() + 60_000, Date.now(), queueId)
}

/** One global concurrent model report; reserve 8192 tokens, 32768/hour, before model IO. */
export function startKanbanDiagnosticBatch(queueIds: string[]): boolean {
  const connection=db();connection.exec('BEGIN IMMEDIATE')
  try {
    const now=Date.now()
    const active=connection.prepare(`SELECT COUNT(*) AS count FROM ${ADMISSIONS} WHERE status='running'`).get() as {count:number}
    const used=connection.prepare(`SELECT COALESCE(SUM(tokens),0) AS tokens FROM ${ADMISSIONS} WHERE reserved_at > ?`).get(now-3_600_000) as {tokens:number}
    if (!queueIds.length || active.count>0 || used.tokens+8192>32768) {connection.exec('ROLLBACK');return false}
    const batchId=randomUUID()
    for(const id of queueIds) {
      const result=connection.prepare(`UPDATE ${TABLE} SET status='running', attempts=attempts+1, batch_id=?, updated_at=? WHERE queue_id=? AND status='pending' AND attempts < 3`).run(batchId,now,id)
      if(Number(result.changes)!==1){connection.exec('ROLLBACK');return false}
    }
    connection.prepare(`INSERT INTO ${ADMISSIONS}(id,reserved_at) VALUES (?,?)`).run(batchId,now)
    connection.exec('COMMIT');return true
  } catch(error){connection.exec('ROLLBACK');throw error}
}
export function finishKanbanDiagnostic(queueId: string, success: boolean, actualTokens?: number): void {
  settleAdmission(queueId, actualTokens)
  db().prepare(`UPDATE ${TABLE} SET status=CASE WHEN ?=1 THEN 'completed' WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,
    next_attempt_at=?,updated_at=? WHERE queue_id=? AND status='running'`)
    .run(Number(success),Date.now()+600_000,Date.now(),queueId)
}
export function cancelKanbanDiagnostic(queueId: string): void {
  settleAdmission(queueId)
  db().prepare(`UPDATE ${TABLE} SET status='cancelled',updated_at=? WHERE queue_id=? AND status IN ('pending','running')`)
    .run(Date.now(),queueId)
}
/** The old process cannot own a run after restart; retry with the same durable identity. */
export function recoverKanbanDiagnostics(): void {
  db().prepare(`UPDATE ${ADMISSIONS} SET status='abandoned' WHERE status='running'`).run()
  db().prepare(`UPDATE ${TABLE} SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END, updated_at=? WHERE status='running'`)
    .run(Date.now())
}

export function kanbanSessionDiagnosticCoolingDown(sessionId: string): boolean {
  return Boolean(db().prepare(`SELECT 1 FROM ${TABLE} WHERE json_extract(payload_json,'$.sessionId')=?
    AND attempts > 0 AND status IN ('running','completed') AND updated_at > ? LIMIT 1`)
    .get(sessionId,Date.now()-600_000))
}

function settleAdmission(queueId: string, actualTokens?: number): void {
  const row=db().prepare(`SELECT batch_id FROM ${TABLE} WHERE queue_id=?`).get(queueId) as {batch_id:string|null}|undefined
  if(row?.batch_id) db().prepare(`UPDATE ${ADMISSIONS} SET status='settled', tokens=MAX(tokens,?) WHERE id=?`)
    .run(Number.isFinite(actualTokens)?Math.max(0,Math.ceil(actualTokens!)):8192,row.batch_id)
}
