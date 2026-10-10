// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { effectScope, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
const api = vi.hoisted(() => ({ fetch: vi.fn(), remove: vi.fn() }))
vi.mock('@/api/studio/kanban-notifications', () => ({ fetchKanbanSessionNotifications: api.fetch, unsubscribeKanbanSessionNotification: api.remove }))
import { useKanbanNotifications } from '@/composables/useKanbanNotifications'
function deferred() { let resolve!: (v: any) => void; const promise = new Promise<any>(r => { resolve = r }); return { promise, resolve } }
const result = (id: string) => ({ subscriptions: [{ id, board: 'arbitrary-board', task_id: 'arbitrary-task' }], notifications: [{ id, label: id }] })
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })
describe('display-only Kanban polling', () => {
  it.each([403, 404])('stops polling and clears stale notices after terminal HTTP %s', async status => {
    vi.useFakeTimers()
    api.fetch.mockResolvedValueOnce(result('private')).mockRejectedValue(Object.assign(new Error('denied'), { status }))
    const target = ref({ id: 'a', profile: 'p' })
    const scope = effectScope()
    const notices = scope.run(() => useKanbanNotifications(target))!
    await flushPromises()
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(api.fetch).toHaveBeenCalledTimes(2)
    expect(notices.state.value.notifications).toEqual([])
    expect(notices.unavailable.value).toBe(true)
    target.value = { id: 'b', profile: 'p' }
    expect(notices.unavailable.value).toBe(false)
    scope.stop()
  })
  it('polls arbitrary session/profile, rejects A → B → A and profile races, stops on disposal', async () => {
    vi.useFakeTimers()
    const a = deferred(), b = deferred(), secondA = deferred()
    api.fetch.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(secondA.promise).mockResolvedValue(result('new-profile'))
    const target = ref<{ id: string; profile: string } | null>({ id: 'not-fixed-a', profile: 'research' })
    const scope = effectScope()
    const notices = scope.run(() => useKanbanNotifications(target))!
    target.value = { id: 'not-fixed-b', profile: 'research' }
    target.value = { id: 'not-fixed-a', profile: 'research' }
    secondA.resolve(result('latest'))
    await flushPromises()
    a.resolve(result('stale-a')); b.resolve(result('stale-b'))
    await flushPromises()
    expect(notices.state.value).toEqual(result('latest'))
    expect(api.fetch.mock.calls.map(c => c.slice(0, 2))).toEqual([['not-fixed-a','research'],['not-fixed-b','research'],['not-fixed-a','research']])
    target.value = { id: 'not-fixed-a', profile: 'another-profile' }
    expect(notices.state.value.notifications).toEqual([])
    await flushPromises()
    expect(notices.state.value).toEqual(result('new-profile'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(api.fetch).toHaveBeenCalledTimes(5)
    scope.stop()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(api.fetch).toHaveBeenCalledTimes(5)
  })
  it('captures unsubscribe target and does not refresh or clear busy on another session', async () => {
    const remove = deferred()
    api.fetch.mockResolvedValue(result('a')); api.remove.mockReturnValue(remove.promise)
    const target = ref({ id: 'a', profile: 'p' })
    const scope = effectScope(); const notices = scope.run(() => useKanbanNotifications(target))!
    await flushPromises()
    const pending = notices.unsubscribe('subscription/id')
    target.value = { id: 'b', profile: 'other' }
    await flushPromises()
    remove.resolve(undefined); await pending
    expect(api.remove).toHaveBeenCalledWith('a','p','subscription/id')
    expect(api.fetch).toHaveBeenCalledTimes(2)
    scope.stop()
  })
  it('retains persisted notices on transient failure and retries without overlapping polls', async () => {
    vi.useFakeTimers(); const slow = deferred()
    api.fetch.mockResolvedValueOnce(result('persisted')).mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(slow.promise)
    const scope = effectScope(); const notices = scope.run(() => useKanbanNotifications(ref({ id:'x', profile:'p' })))!
    await flushPromises(); await vi.advanceTimersByTimeAsync(10_000)
    expect(notices.error.value).toBe(true); expect(notices.state.value).toEqual(result('persisted'))
    await vi.advanceTimersByTimeAsync(40_000)
    expect(api.fetch).toHaveBeenCalledTimes(3)
    scope.stop(); slow.resolve(result('late')); await flushPromises()
    expect(notices.state.value).toEqual(result('persisted'))
  })
})
