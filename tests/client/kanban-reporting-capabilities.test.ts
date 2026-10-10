// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { invalidateAuth } from '@/api/auth-invalidation'
const fetchCapabilities = vi.hoisted(() => vi.fn())
vi.mock('@/api/studio/kanban-notifications', () => ({ fetchKanbanReportingCapabilities: fetchCapabilities }))
import { useKanbanReportingCapabilities } from '@/composables/useKanbanReportingCapabilities'
afterEach(() => { vi.clearAllMocks() })
describe('Kanban capability lifetime', () => {
  it.each(['logout', 'dispose'] as const)('cannot re-enable after %s with a late response', async action => {
    let resolve!: (value: unknown) => void
    fetchCapabilities.mockReturnValue(new Promise(complete => { resolve = complete }))
    const scope = effectScope()
    const state = scope.run(useKanbanReportingCapabilities)!
    expect(state.value.enabled).toBe(false)
    if (action === 'logout') invalidateAuth()
    else scope.stop()
    resolve({ enabled: true, diagnosticsEnabled: true })
    await flushPromises()
    expect(state.value).toEqual({ enabled: false, diagnosticsEnabled: false })
    expect(fetchCapabilities.mock.calls[0][0].aborted).toBe(true)
    scope.stop()
  })
  it('does not expose controls when an older server lacks the module', async () => {
    fetchCapabilities.mockRejectedValue(new Error('not found'))
    const scope = effectScope()
    const state = scope.run(useKanbanReportingCapabilities)!
    await flushPromises()
    expect(state.value).toEqual({ enabled: false, diagnosticsEnabled: false })
    scope.stop()
  })
})
