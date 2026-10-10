import { DatabaseSync } from 'node:sqlite'
interface NativeBoardRef { db_path?: string; archived: boolean }

/**
 * The native `hermes kanban show --json` projects events without their IDs.
 * Read only the native event identity/kind/time from the DB path returned by
 * `hermes kanban boards list --json`; never create/migrate/mutate that database.
 * Task and board authorization are separately checked against the CLI on every
 * subscription and poll. The path is never accepted from HTTP or persisted.
 */
function withNativeBoard<T>(board: NativeBoardRef, read: (db: DatabaseSync) => T): T {
  if (!board.db_path || board.archived) throw new Error('native_board_unavailable')
  const db = new DatabaseSync(board.db_path, { readOnly: true })
  try { return read(db) } finally { db.close() }
}

export interface NativeKanbanEvent {
  id: number
  kind: string
  occurred_at: number
  /** Most recent terminal review event before completion was a review request. */
  from_review: boolean
  run_id?: number | null
  payload?: Record<string, unknown>
}

export function latestNativeKanbanEventId(board: NativeBoardRef, taskId: string): number {
  return withNativeBoard(board, db => {
    const row = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM task_events WHERE task_id = ?')
      .get(taskId) as { id: number }
    return row.id
  })
}

export function readNativeKanbanEvents(board: NativeBoardRef, taskId: string, afterId: number): NativeKanbanEvent[] {
  return withNativeBoard(board, db => {
    const rows = db.prepare(`SELECT id, kind, created_at, payload, run_id FROM task_events
      WHERE task_id = ? AND id > ? ORDER BY id LIMIT 100`).all(taskId, afterId) as Array<{
      id: number; kind: string; created_at: number; payload: string | null; run_id: number | null
    }>
    const lastReviewTransition = db.prepare(`SELECT kind FROM task_events
      WHERE task_id = ? AND id < ? AND kind IN ('review_requested', 'changes_requested', 'completed')
      ORDER BY id DESC LIMIT 1`)
    return rows.map(row => ({
      id: row.id,
      kind: row.kind,
      occurred_at: row.created_at,
      run_id: row.run_id,
      payload: parsePayload(row.payload),
      from_review: row.kind === 'completed'
        && (lastReviewTransition.get(taskId, row.id) as { kind: string } | undefined)?.kind === 'review_requested',
    }))
  })
}

function parsePayload(raw: string | null): Record<string, unknown> {
  if (!raw || raw.length > 65536) return {}
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

/** CLI omits block_kind and creator provenance. Read them from the authorized canonical board only. */
export function readNativeKanbanTaskHints(board: NativeBoardRef, taskId: string) {
  return withNativeBoard(board, db => {
    const task = db.prepare('SELECT id, assignee, status, block_kind, session_id, created_at FROM tasks WHERE id = ?')
      .get(taskId) as { id: string; assignee: string | null; status: string; block_kind: string | null; session_id: string | null; created_at: number } | undefined
    if (!task) return null
    const created = db.prepare("SELECT payload FROM task_events WHERE task_id = ? AND kind = 'created' ORDER BY id LIMIT 1")
      .get(taskId) as { payload: string | null } | undefined
    const creator = parsePayload(created?.payload || null).creator_task_id
    return { ...task, creator_task_id: typeof creator === 'string' ? creator : null }
  })
}

/** Bounded origin discovery; only exact, durable native session provenance is eligible. */
export function listNativeKanbanOrigins(board: NativeBoardRef) {
  return withNativeBoard(board, db => db.prepare(
    "SELECT id, session_id, created_at FROM tasks WHERE session_id IS NOT NULL AND status != 'archived' AND created_at >= ? ORDER BY created_at DESC LIMIT 100")
    .all(Math.floor(Date.now() / 1000) - 7 * 86400) as Array<{id:string;session_id:string;created_at:number}>)
}

/** Execution-time invalidation is independent of the slower notification poll cursor. */
export function nativeKanbanTransitionAfter(board: NativeBoardRef, taskId: string, eventId: number): boolean {
  return withNativeBoard(board,db=>Boolean(db.prepare(
    "SELECT 1 FROM task_events WHERE task_id=? AND id>? AND kind IN ('status','ready','running','claimed','completed','review','review_requested','changes_requested','blocked','failed','gave_up','crashed','timed_out','needs_input','capability','block_loop_detected','triage') LIMIT 1")
    .get(taskId,eventId)))
}
