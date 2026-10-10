export interface KanbanMilestoneEvent {
  id: number
  kind: string
  /** Native Unix seconds. */
  occurred_at: number
  from_review: boolean
  payload?: unknown
  run_id?: string | null
}
export interface KanbanTaskRef {
  id: string
  assignee: string | null
  status?: string
  block_kind?: string | null
  creator_task_id?: string | null
}
export const KANBAN_WAKE_GRACE_MS = 60_000
export const KANBAN_WAKE_COOLDOWN_MS = 600_000
export const KANBAN_WAKE_LEASE_MS = 60_000
export const KANBAN_WAKE_MAX_ATTEMPTS = 3
const diagnostic = new Set(['capability', 'block_loop_detected', 'triage', 'gave_up'])
const ignored = new Set(['heartbeat', 'claimed', 'dependency', 'transient'])
const labels: Record<string, string> = {
  created: 'Task created', completed: 'Task completed', review: 'Review requested',
  review_requested: 'Review requested', changes_requested: 'Changes requested',
  failed: 'Task failed', blocked: 'Task blocked', needs_input: 'Task needs input',
  gave_up: 'Task stopped after retries', crashed: 'Task run crashed', timed_out: 'Task run timed out',
  capability: 'Task capability blocked', block_loop_detected: 'Task block loop detected', triage: 'Task needs triage',
}
/** Display-only plain text. Never interpolate payloads into executable instructions. */
export function kanbanPlainText(value: unknown, max = 320): string {
  if (typeof value !== 'string') return ''
  return value.slice(0, 4096).replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/[`*_#\[\]\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
}
export function kanbanPolicy(event: KanbanMilestoneEvent, task: KanbanTaskRef) {
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown> : {}
  const block = typeof payload.block_kind === 'string' ? payload.block_kind
    : typeof payload.kind === 'string' ? payload.kind : task.block_kind
  if (ignored.has(event.kind) || (['blocked', 'failed', 'crashed', 'timed_out'].includes(event.kind)
    && (block === 'dependency' || block === 'transient'))) return null
  const label = event.kind === 'completed' && event.from_review ? 'QA PASS: task completed' : labels[event.kind]
  if (!label) return null
  const wake = !task.creator_task_id && block !== 'needs_input' && event.kind !== 'needs_input' && !['created', 'completed', 'review', 'review_requested', 'changes_requested'].includes(event.kind)
    && (diagnostic.has(event.kind) || diagnostic.has(block || ''))
  return { label, summary: kanbanPlainText(payload.summary ?? payload.reason ?? payload.message), wake }
}
export function kanbanRecovered(task: KanbanTaskRef): boolean {
  return ['ready', 'running', 'done', 'completed'].includes(task.status || '')
}
/** A later authoritative transition makes old diagnostics stale, even across event pages. */
export function kanbanStateEvent(event: KanbanMilestoneEvent): boolean {
  return ['status', 'ready', 'running', 'claimed', 'completed', 'review', 'review_requested', 'changes_requested',
    'blocked', 'failed', 'gave_up', 'crashed', 'timed_out', 'needs_input', 'capability', 'block_loop_detected', 'triage'].includes(event.kind)
}
