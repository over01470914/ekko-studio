import { onScopeDispose, ref } from 'vue'
import { fetchKanbanReportingCapabilities, type KanbanReportingCapabilities } from '@/api/studio/kanban-notifications'
import { onAuthInvalidated } from '@/api/auth-invalidation'

export function useKanbanReportingCapabilities() {
  const capabilities = ref<KanbanReportingCapabilities>({ enabled: false, diagnosticsEnabled: false })
  const controller = new AbortController()
  const clear = () => {
    controller.abort()
    capabilities.value = { enabled: false, diagnosticsEnabled: false }
  }
  const stopAuth = onAuthInvalidated(clear)
  void fetchKanbanReportingCapabilities(controller.signal).then(result => {
    if (!controller.signal.aborted) capabilities.value = result
  }).catch(() => {})
  onScopeDispose(() => { clear(); stopAuth() })
  return capabilities
}
