import { describe, expect, it } from 'vitest'
import { groupKanbanNotifications } from '@/utils/hermes/kanban-notifications'

describe('session notification grouping', () => {
  const notice = (id: number, board: string, task_id: string, occurred_at: number) => ({
    id, board, task_id, occurred_at, label: 'Update', kind: 'blocked', summary: 'Full details',
  })
  it('keeps latest updates first without mutating or discarding history', () => {
    const notices = [notice(1, 'board', 'task', 10), notice(2, 'board', 'other', 20), notice(3, 'board', 'task', 30)]
    const groups = groupKanbanNotifications(notices)
    expect(groups.map(group => group.taskId)).toEqual(['task', 'other'])
    expect(groups[0].notices.map(item => item.id)).toEqual([3, 1])
    expect(notices.map(item => item.id)).toEqual([1, 2, 3])
    expect(groups[0].notices[1].summary).toBe('Full details')
  })
  it('does not mix identically named tasks across boards or delimiter collisions', () => {
    expect(groupKanbanNotifications([
      notice(1, 'one', 'task', 1), notice(2, 'two', 'task', 1),
      notice(3, 'one:two', 'three', 1), notice(4, 'one', 'two:three', 1),
    ])).toHaveLength(4)
  })
  it('handles no notifications', () => {
    expect(groupKanbanNotifications([])).toEqual([])
  })
})
