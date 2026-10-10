import { request } from '../client'

export interface KanbanReportingCapabilities { enabled: boolean; diagnosticsEnabled: boolean }
export function fetchKanbanReportingCapabilities(signal?: AbortSignal): Promise<KanbanReportingCapabilities> {
  return request('/api/studio/kanban-reporting', { signal })
}

export interface KanbanSessionSubscription {
  id: string | number
  board: string
  task_id: string
  wake_enabled?: boolean
  active?: boolean
}
export interface KanbanSessionNotification {
  id: string | number
  task_id: string
  board: string
  kind: string
  label: string
  occurred_at: number
  summary?: string | null
}
export interface KanbanSessionNotifications {
  subscriptions: KanbanSessionSubscription[]
  notifications: KanbanSessionNotification[]
}
function path(sessionId: string, profile: string, subscriptionId?: string | number): string {
  const suffix = subscriptionId === undefined ? '' : '/' + encodeURIComponent(String(subscriptionId))
  return '/api/studio/sessions/' + encodeURIComponent(sessionId) + '/kanban-notifications' + suffix + '?'+ new URLSearchParams({ profile })
}
export function fetchKanbanSessionNotifications(sessionId: string, profile: string, signal?: AbortSignal): Promise<KanbanSessionNotifications> {
  return request(path(sessionId, profile), { signal })
}
export function subscribeKanbanSessionNotification(sessionId: string, profile: string, data: { board: string; task_id: string; wake_enabled?: boolean }): Promise<KanbanSessionSubscription> {
  return request(path(sessionId, profile), { method: 'POST', body: JSON.stringify(data) })
}
export async function unsubscribeKanbanSessionNotification(sessionId: string, profile: string, subscriptionId: string | number): Promise<void> {
  await request(path(sessionId, profile, subscriptionId), { method: 'DELETE' })
}
