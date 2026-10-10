// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import ChatView from '@/views/hermes/ChatView.vue'
const mocks = vi.hoisted(() => ({
  app: { loadModels: vi.fn() },
  profiles: { profiles: [{ name: 'default' }, { name: 'other' }], activeProfileName: 'default', fetchProfiles: vi.fn(), switchProfile: vi.fn() },
  settings: { fetchSettings: vi.fn() },
  chat: { sessionsLoaded: false, isLoadingSessions: false, isLoadingMessages: false, activeSessionId: null as string | null, activeSession: null, sessions: [] as { id: string }[], sessionProfileFilter: null, loadSessions: vi.fn(), switchSession: vi.fn(), setRuntimeMode: vi.fn(), validateSessionProfileFilter: vi.fn(), setSessionProfileFilter: vi.fn(), clearActiveSession: vi.fn() },
  replace: vi.fn(),
}))
vi.mock('@/stores/hermes/app', () => ({ useAppStore: () => mocks.app }))
vi.mock('@/stores/hermes/profiles', () => ({ useProfilesStore: () => profileState }))
vi.mock('@/stores/hermes/settings', () => ({ useSettingsStore: () => mocks.settings }))
vi.mock('@/stores/hermes/chat', () => ({ useChatStore: () => mocks.chat }))
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace: mocks.replace }) }))
vi.mock('@/components/common/PageLoading.vue', () => ({ default: { name: 'PageLoading', props: ['show'], template: '<div><slot /></div>' } }))
vi.mock('@/components/hermes/chat/ChatPanel.vue', () => ({ default: { name: 'ChatPanel', template: '<div data-chat-panel />' } }))
const route = reactive({ name: 'hermes.chat', params: {} as Record<string, string>, query: {} as Record<string, string>, meta: {} })
const profileState = reactive(mocks.profiles)
function deferred() {
  let resolve!: () => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let wrapper: VueWrapper | undefined
function render() {
  wrapper = mount(ChatView, { global: { mocks: { $t: (key: string) => key } } })
  return wrapper
}
describe('ChatView initialization boundaries', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.resetAllMocks()
    route.params = {}; route.query = {}; profileState.activeProfileName = 'default'
    Object.assign(mocks.chat, { sessionsLoaded: false, isLoadingSessions: false, isLoadingMessages: false, activeSessionId: null, sessions: [] })
    mocks.chat.switchSession.mockResolvedValue(false)
    mocks.profiles.fetchProfiles.mockResolvedValue(undefined)
    mocks.profiles.switchProfile.mockResolvedValue(true)
    mocks.app.loadModels.mockResolvedValue(undefined)
    mocks.settings.fetchSettings.mockResolvedValue(true)
    mocks.chat.loadSessions.mockImplementation(async () => { mocks.chat.sessionsLoaded = true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.useRealTimers(); vi.restoreAllMocks() })
  it('reveals chat while models and settings remain pending', async () => {
    mocks.app.loadModels.mockReturnValue(new Promise(() => {}))
    mocks.settings.fetchSettings.mockReturnValue(new Promise(() => {}))
    const view = render(); await flushPromises()
    expect(mocks.chat.loadSessions).toHaveBeenCalledOnce()
    expect(view.getComponent({ name: 'PageLoading' }).props('show')).toBe(false)
    expect(view.find('[data-chat-panel]').exists()).toBe(true)
  })
  it('catches synchronous and asynchronous enhancement exceptions', async () => {
    mocks.app.loadModels.mockImplementation(() => { throw new Error('models') })
    mocks.settings.fetchSettings.mockRejectedValue(new Error('settings'))
    const view = render(); await flushPromises()
    expect(console.warn).toHaveBeenCalledTimes(2)
    expect(view.getComponent({ name: 'PageLoading' }).props('show')).toBe(false)
  })
  it('bounds profiles at 10 seconds, allows retry and catches late rejection', async () => {
    const pending = deferred()
    mocks.profiles.fetchProfiles.mockReturnValueOnce(pending.promise)
    const view = render(); await flushPromises(); await vi.advanceTimersByTimeAsync(10_000)
    expect(view.get('[role="alert"]').text()).toContain('common.chatLoadingTimeout')
    expect(view.getComponent({ name: 'PageLoading' }).props('show')).toBe(false)
    await view.get('button').trigger('click'); await flushPromises()
    expect(mocks.profiles.fetchProfiles).toHaveBeenCalledTimes(2)
    expect(view.find('[role="alert"]').exists()).toBe(false)
    pending.reject(new Error('late rejection')); await flushPromises()
    expect(view.find('[role="alert"]').exists()).toBe(false)
  })
  it('warns on a slow session wait without cancelling a valid late history response', async () => {
    const pending = deferred()
    mocks.chat.loadSessions.mockImplementationOnce(() => { mocks.chat.isLoadingSessions = true; return pending.promise })
    const view = render(); await flushPromises()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(view.get('[role="alert"]').text()).toContain('common.chatLoadingTimeout')
    expect(view.getComponent({ name: 'PageLoading' }).props('show')).toBe(false)
    // r3 deliberately changed the old destructive deadline into a warning.
    expect(mocks.chat.switchSession).not.toHaveBeenCalledWith('')
    mocks.chat.isLoadingSessions = false
    mocks.chat.sessionsLoaded = true
    pending.resolve(); await flushPromises()
    expect(view.find('[role="alert"]').exists()).toBe(false)
    expect(view.find('[data-chat-panel]').exists()).toBe(true)
    expect(mocks.chat.loadSessions).toHaveBeenCalledOnce()
  })

  it('puts an already-active but still-loading session under the necessary deadline', async () => {
    route.params = { sessionId: 'pending' }
    mocks.chat.sessionsLoaded = true
    mocks.chat.sessions = [{ id: 'pending' }]
    mocks.chat.activeSessionId = 'pending'
    mocks.chat.isLoadingMessages = true
    mocks.chat.switchSession.mockImplementation(id => id ? new Promise(() => {}) : Promise.resolve(false))
    const view = render(); await flushPromises()
    expect(mocks.chat.switchSession).toHaveBeenCalledWith('pending')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(view.get('[role="alert"]').text()).toContain('common.chatLoadingTimeout')
    expect(view.getComponent({ name: 'PageLoading' }).props('show')).toBe(false)
  })
  it('shows propagated necessary failures with retry', async () => {
    mocks.profiles.fetchProfiles.mockRejectedValueOnce(new Error('unavailable'))
    const view = render(); await flushPromises()
    expect(view.get('[role="alert"]').text()).toContain('common.chatLoadingFailed')
    await view.get('button').trigger('click'); await flushPromises()
    expect(view.find('[data-chat-panel]').exists()).toBe(true)
  })
  it('does not wait for models chained by route profile selection', async () => {
    route.query = { profile: 'other' }
    mocks.profiles.switchProfile.mockImplementation(() => { profileState.activeProfileName = 'other'; return new Promise(() => {}) })
    const view = render(); await flushPromises()
    expect(mocks.chat.setSessionProfileFilter).toHaveBeenCalledWith('other')
    expect(mocks.chat.loadSessions).toHaveBeenCalledOnce()
    expect(view.getComponent({ name: 'PageLoading' }).props('show')).toBe(false)
  })
  it('supersedes initial waits without discarding display settings on same-profile session navigation', async () => {
    const pending = deferred(); mocks.profiles.fetchProfiles.mockReturnValueOnce(pending.promise)
    render(); await flushPromises()
    const { shouldCommit } = mocks.settings.fetchSettings.mock.calls[0][0]
    expect(shouldCommit()).toBe(true)
    route.params = { sessionId: 'new' }
    mocks.chat.loadSessions.mockImplementation(async () => { mocks.chat.activeSessionId = 'new'; mocks.chat.sessionsLoaded = true })
    await flushPromises()
    expect(shouldCommit()).toBe(true)
    expect(mocks.settings.fetchSettings).toHaveBeenCalledOnce()
    expect(mocks.chat.loadSessions).toHaveBeenCalledWith(null, 'new')
    pending.resolve(); await flushPromises()
    expect(mocks.chat.loadSessions).toHaveBeenCalledOnce()
    expect(mocks.replace).not.toHaveBeenCalled()
    route.params = {}; await flushPromises()
    expect(shouldCommit()).toBe(true)
    route.query = { profile: 'other' }; await flushPromises()
    expect(shouldCommit()).toBe(false)
  })
  it('prevents old session completion from redirecting a newer deep link', async () => {
    const old = deferred(); route.params = { sessionId: 'old' }
    mocks.chat.loadSessions.mockImplementationOnce(() => { mocks.chat.isLoadingSessions = true; return old.promise })
    render(); await flushPromises()
    route.params = { sessionId: 'new' }
    mocks.chat.loadSessions.mockImplementation(async () => { mocks.chat.activeSessionId = 'new'; mocks.chat.sessionsLoaded = true; mocks.chat.isLoadingSessions = false })
    await flushPromises(); old.resolve(); await flushPromises()
    expect(mocks.chat.loadSessions).toHaveBeenLastCalledWith(null, 'new')
    expect(mocks.replace).not.toHaveBeenCalled()
  })
  it('invalidates selection, settings commits and continuations on unmount', async () => {
    const pending = deferred(); mocks.profiles.fetchProfiles.mockReturnValueOnce(pending.promise)
    render(); await flushPromises()
    const { shouldCommit } = mocks.settings.fetchSettings.mock.calls[0][0]
    wrapper!.unmount(); wrapper = undefined
    expect(shouldCommit()).toBe(false)
    expect(mocks.chat.switchSession).toHaveBeenCalledWith('')
    pending.resolve(); await flushPromises()
    expect(mocks.chat.loadSessions).not.toHaveBeenCalled()
  })
})
