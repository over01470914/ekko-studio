import type { KanbanSessionNotification } from '@/api/studio/kanban-notifications'

export function groupKanbanNotifications(notifications: KanbanSessionNotification[]) {
  const groups = new Map<string, { key: string; board: string; taskId: string; notices: KanbanSessionNotification[] }>()
  for (const notice of [...notifications].sort((left, right) => right.occurred_at - left.occurred_at)) {
    const key = JSON.stringify([notice.board, notice.task_id])
    let group = groups.get(key)
    if (!group) {
      group = { key, board: notice.board, taskId: notice.task_id, notices: [] }
      groups.set(key, group)
    }
    group.notices.push(notice)
  }
  return [...groups.values()]
}
