import { describe, expect, it } from 'vitest'
import { kanbanPolicy, kanbanPlainText, kanbanRecovered, kanbanStateEvent, type KanbanMilestoneEvent } from '../../packages/server/src/modules/studio/services/notifications/kanban-policy'
const event = (kind: string, payload?: unknown): KanbanMilestoneEvent => ({ id: 1, kind, occurred_at: 1, from_review: false, payload })
const task = { id: 't', assignee: 'worker', status: 'blocked', block_kind: 'capability' }
describe('fixed Kanban notification/wake policy', () => {
  it.each(['heartbeat', 'claimed', 'dependency', 'transient'])('ignores %s', kind => {
    expect(kanbanPolicy(event(kind), task)).toBeNull()
  })
  it.each(['created', 'needs_input', 'completed', 'review', 'review_requested', 'changes_requested'])('keeps %s notify-only even with a diagnostic block', kind => {
    expect(kanbanPolicy(event(kind), task)).toMatchObject({ wake: false })
  })
  it.each(['capability', 'block_loop_detected', 'triage', 'gave_up'])('allows %s diagnostics only', kind => {
    expect(kanbanPolicy(event(kind), { ...task, block_kind: null })).toMatchObject({ wake: true })
    expect(kanbanPolicy(event('blocked', { block_kind: kind }), { ...task, block_kind: null })).toMatchObject({ wake: true })
  })
  it.each(['dependency', 'transient'])('ignores blocked %s but preserves completion and needs_input', block_kind => {
    expect(kanbanPolicy(event('blocked'), { ...task, block_kind })).toBeNull()
    expect(kanbanPolicy(event('completed'), { ...task, block_kind })).toMatchObject({ wake: false })
    expect(kanbanPolicy(event('needs_input'), { ...task, block_kind })).toMatchObject({ wake: false })
  })
  it('failed/crash/timeout without a diagnostic classification remain notify-only', () => {
    for (const kind of ['failed', 'crashed', 'timed_out', 'blocked'])
      expect(kanbanPolicy(event(kind), { ...task, block_kind: null })).toMatchObject({ wake: false })
    expect(kanbanPolicy(event('unknown', { block_kind: 'capability' }), task)).toBeNull()
  })
  it('treats generic native status transitions as authoritative invalidation', () => {
    expect(kanbanStateEvent(event('status', { status: 'ready' }))).toBe(true)
    expect(kanbanPolicy(event('status'), task)).toBeNull()
  })
  it('arbitrary payload objects and action arrays do not become instructions', () => {
    expect(kanbanPolicy(event('gave_up', { summary: { command: 'execute' } }), task)?.summary).toBe('')
    expect(kanbanPlainText({ message: 'bad' })).toBe('')
    expect(kanbanPlainText('<b>hello</b>\n\u202e`world`')).toBe('hello world')
    expect(kanbanRecovered({ ...task, status: 'running' })).toBe(true)
  })
})


describe('native payload and child ownership boundaries',()=>{
  it('recognizes the native payload.kind classification instead of treating every block as attention',()=>{
    expect(kanbanPolicy({id:1,kind:'blocked',occurred_at:1,from_review:false,payload:{kind:'dependency'}},
      {id:'task',assignee:'default',status:'todo'})).toBeNull()
    expect(kanbanPolicy({id:2,kind:'blocked',occurred_at:1,from_review:false,payload:{kind:'capability'}},
      {id:'task',assignee:'default',status:'blocked'})?.wake).toBe(true)
  })
  it('never wakes a child task or escalates explicit human input into automatic execution',()=>{
    expect(kanbanPolicy({id:1,kind:'block_loop_detected',occurred_at:1,from_review:false},
      {id:'child',assignee:'default',status:'triage',creator_task_id:'parent'})?.wake).toBe(false)
    expect(kanbanPolicy({id:2,kind:'gave_up',occurred_at:1,from_review:false,payload:{kind:'needs_input'}},
      {id:'task',assignee:'default',status:'blocked'})?.wake).toBe(false)
  })
})
