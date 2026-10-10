import { ref, watch, onScopeDispose, type Ref } from 'vue'
import { fetchKanbanSessionNotifications, unsubscribeKanbanSessionNotification, type KanbanSessionNotifications } from '@/api/studio/kanban-notifications'

// Persisted backend notices are display-only; never append them to chat messages.
export function useKanbanNotifications(target: Readonly<Ref<{ id: string; profile: string } | null>>, intervalMs = 10_000) {
  const state = ref<KanbanSessionNotifications>({ subscriptions: [], notifications: [] })
  const error = ref(false)
  const busy = ref(false)
  let generation = 0
  let refresh: (() => Promise<void>) | undefined
  watch(target, (scope, _, cleanup) => {
    const current = ++generation
    state.value = { subscriptions: [], notifications: [] }
    error.value = false
    busy.value = false
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
        state.value = result
        error.value = false
      } catch {
        if (current === generation && requestId === sequence) error.value = true
      } finally {
        if (current === generation && requestId === sequence) timer = setTimeout(() => void poll(), intervalMs)
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
  return { state, error, busy, unsubscribe }
}
