import { ref, watch, onScopeDispose, type Ref } from 'vue'
import { fetchKanbanSessionNotifications, unsubscribeKanbanSessionNotification, type KanbanSessionNotifications } from '@/api/studio/kanban-notifications'

// Persisted backend notices are display-only; never append them to chat messages.
export function useKanbanNotifications(target: Readonly<Ref<{ id: string; profile: string } | null>>, intervalMs = 10_000) {
  const state = ref<KanbanSessionNotifications>({ subscriptions: [], notifications: [] })
  const error = ref(false)
  const unavailable = ref(false)
  const busy = ref(false)
  const changeVersion = ref(0)
  let generation = 0
  let refresh: (() => Promise<void>) | undefined
  watch(target, (scope, _, cleanup) => {
    const current = ++generation
    state.value = { subscriptions: [], notifications: [] }
    error.value = false
    unavailable.value = false
    busy.value = false
    changeVersion.value = 0
    let previousSnapshot: string | undefined
    refresh = undefined
    if (!scope) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    let sequence = 0
    const poll = async () => {
      const requestId = ++sequence
      controller?.abort()
      controller = new AbortController()
      if (timer) clearTimeout(timer)
      try {
        const result = await fetchKanbanSessionNotifications(scope.id, scope.profile, controller.signal)
        if (current !== generation || requestId !== sequence) return
        const snapshot = JSON.stringify({
          subscriptions: result.subscriptions.map(subscription => [
            subscription.id, subscription.board, subscription.task_id,
            subscription.active !== false, subscription.wake_enabled === true,
          ]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
          notifications: result.notifications.map(notice => [
            notice.id, notice.board, notice.task_id, notice.kind, notice.label,
            notice.occurred_at, notice.summary ?? '',
          ]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
        })
        if (previousSnapshot !== undefined && snapshot !== previousSnapshot) changeVersion.value++
        previousSnapshot = snapshot
        state.value = result
        error.value = false
      } catch (cause) {
        if (current === generation && requestId === sequence) {
          const status = (cause as { status?: number } | null)?.status
          unavailable.value = status === 403 || status === 404
          error.value = !unavailable.value
          if (unavailable.value) state.value = { subscriptions: [], notifications: [] }
        }
      } finally {
        if (current === generation && requestId === sequence && !unavailable.value) timer = setTimeout(() => void poll(), intervalMs)
      }
    }
    refresh = poll
    void poll()
    cleanup(() => {
      ++generation
      controller?.abort()
      if (timer) clearTimeout(timer)
    })
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => { ++generation })
  async function unsubscribe(id: string | number) {
    const scope = target.value
    if (!scope || busy.value) return
    const current = generation
    busy.value = true
    try {
      await unsubscribeKanbanSessionNotification(scope.id, scope.profile, id)
      if (current === generation) await refresh?.()
    } catch {
      if (current === generation) error.value = true
    } finally {
      if (current === generation) busy.value = false
    }
  }
  return { state, error, unavailable, busy, unsubscribe, changeVersion }
}
