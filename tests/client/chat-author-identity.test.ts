// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { invalidateAuth } from '@/api/auth-invalidation'

const api = vi.hoisted(() => ({ startRunViaSocket: vi.fn(), fetchCurrentUser: vi.fn(), fetchMyAvatar: vi.fn() }))
const presetState = vi.hoisted(() => ({ pendingWrite: null as Promise<boolean> | null }))
vi.mock('@/services/session-model-presets', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/session-model-presets')>()
  return { ...actual, createSessionModelPresets: (...args: Parameters<typeof actual.createSessionModelPresets>) => ({
    ...actual.createSessionModelPresets(...args), pendingWrite: () => presetState.pendingWrite,
  }) }
})
vi.mock('@/api/studio/auth', () => ({ fetchCurrentUser: api.fetchCurrentUser, fetchMyAvatar: api.fetchMyAvatar }))
vi.mock('@/api/studio/background-status', () => ({ observeBackgroundStatus: vi.fn(() => vi.fn()) }))
vi.mock('@/api/client', () => ({ getActiveProfileName: () => 'default', getStoredUsername: () => 'account', hasApiKey: () => true }))
vi.mock('@/api/studio/chat', () => ({
  startRunViaSocket: api.startRunViaSocket, resumeSession: vi.fn(), registerSessionHandlers: vi.fn(),
  unregisterSessionHandlers: vi.fn(), getChatRunSocket: vi.fn(() => ({ emit: vi.fn() })),
  respondToolApproval: vi.fn(), respondClarify: vi.fn(), onPeerUserMessage: vi.fn(),
  onSessionCommand: vi.fn(), onSessionTitleUpdated: vi.fn(), onRunUsageUpdated: vi.fn(() => vi.fn()),
  onSessionWorkspaceUpdated: vi.fn(), onSessionSettingsUpdated: vi.fn(),
}))
vi.mock('@/api/studio/sessions', () => ({
  archiveSession: vi.fn(), deleteSession: vi.fn(), fetchSession: vi.fn(), fetchSessions: vi.fn(async () => []),
  fetchWorkspaceRunChangesForSession: vi.fn(async () => []), fetchWorkspaceRunChangeFile: vi.fn(), setSessionModel: vi.fn(),
}))
vi.mock('@/api/hermes/system', () => ({
  checkHealth: vi.fn(), fetchAvailableModels: vi.fn(), addCustomModel: vi.fn(), removeCustomModel: vi.fn(),
  updateDefaultModel: vi.fn(), updateModelVisibility: vi.fn(), triggerUpdate: vi.fn(), updateModelAlias: vi.fn(),
}))
vi.mock('@/utils/completion-sound', () => ({ primeCompletionSound: vi.fn(), playCompletionSound: vi.fn() }))
import { useChatStore, type Message, type Session } from '@/stores/hermes/chat'
import { useChatAuthorIdentity } from '@/composables/useChatAuthorIdentity'
import { useAccountStore } from '@/stores/account'

function session(id: string, messages: Message[] = []): Session {
  return { id, profile: 'research', title: id, messages, createdAt: Date.now(), updatedAt: Date.now() }
}
function message(id: string): Message {
  return { id, role: 'user', content: id, timestamp: Date.now() }
}
function identity() {
  let author!: ReturnType<typeof useChatAuthorIdentity>
  const wrapper = mount(defineComponent({ setup() { author = useChatAuthorIdentity(); return () => h('div') } }))
  return { author, wrapper }
}
beforeEach(() => {
  presetState.pendingWrite = null
  setActivePinia(createPinia())
  vi.clearAllMocks()
  api.fetchCurrentUser.mockResolvedValue({ username: 'account' })
  api.fetchMyAvatar.mockResolvedValue({ type: 'default' })
  api.startRunViaSocket.mockReturnValue({ abort: vi.fn() })
})

describe('explicit local message author provenance', () => {
  it('binds to the publishing session after preset persistence, not the current view or peer input', async () => {
    const chat = useChatStore()
    chat.sessions = [session('one'), session('two')]
    chat.activeSessionId = 'one'
    chat.activeSession = chat.sessions[0]
    const { author, wrapper } = identity()
    let complete!: (value: boolean) => void
    presetState.pendingWrite = new Promise(resolve => { complete = resolve })
    const pending = chat.sendMessage('after preset commit')
    await Promise.resolve()
    chat.sessions[0].messages.push(message('peer-during-preset'))
    chat.activeSessionId = 'two'
    chat.activeSession = chat.sessions[1]
    complete(true)
    await pending
    const own = chat.sessions[0].messages.find(item => item.content === 'after preset commit')!
    expect(own).toBeDefined()
    expect(author.isLocalAuthor('one', own)).toBe(true)
    expect(author.isLocalAuthor('two', own)).toBe(false)
    expect(author.isLocalAuthor('one', message('peer-during-preset'))).toBe(false)
    wrapper.unmount()
  })

  it.each(['failed', 'invalidated'] as const)('does not publish author proof for a %s pending send', async mode => {
    const chat = useChatStore()
    chat.sessions = [session('one')]
    chat.activeSessionId = 'one'
    chat.activeSession = chat.sessions[0]
    const { author, wrapper } = identity()
    let complete!: (value: boolean) => void
    presetState.pendingWrite = new Promise(resolve => { complete = resolve })
    const pending = chat.sendMessage('not published')
    await Promise.resolve()
    if (mode === 'invalidated') invalidateAuth()
    complete(mode !== 'failed')
    await pending
    expect(chat.sessions[0].messages).toEqual([])
    expect(api.startRunViaSocket).not.toHaveBeenCalled()
    expect(author.isLocalAuthor('one', message('peer'))).toBe(false)
    wrapper.unmount()
  })
  it('labels only exact local input in a resumed transcript and preserves it across copies', async () => {
    const chat = useChatStore()
    const old = message('history')
    chat.sessions = [session('one', [old])]
    chat.activeSessionId = 'one'
    chat.activeSession = chat.sessions[0]
    const { author, wrapper } = identity()
    expect(author.isLocalAuthor('one', old)).toBe(false)
    const sending = chat.sendMessage('my input')
    const own = chat.messages.findLast(item => item.role === 'user')!
    // The action publishes synchronously; provenance exists before Promise settlement.
    expect(author.isLocalAuthor('one', own)).toBe(true)
    await sending
    expect(author.isLocalAuthor('one', { ...own })).toBe(true)
    expect(author.isLocalAuthor('other', own)).toBe(false)
    expect(author.isLocalAuthor('one', old)).toBe(false)
    expect(author.isLocalAuthor('one', message('peer'))).toBe(false)
    expect(author.account.username).toBe('account')
    author.account.username = 'renamed-account'
    author.account.avatar = { type: 'image', dataUrl: 'data:image/png;base64,fixture' }
    expect(author.account.username).toBe('renamed-account')
    expect(author.account.profileAvatar?.dataUrl).toBe('data:image/png;base64,fixture')
    chat.sessions.push(session('other', [message('peer')]))
    chat.activeSessionId = 'other'
    chat.activeSession = chat.sessions[1]
    expect(author.isLocalAuthor('other', message('peer'))).toBe(false)
    chat.activeSessionId = 'one'
    chat.activeSession = chat.sessions[0]
    expect(author.isLocalAuthor('one', own)).toBe(true)
    invalidateAuth()
    expect(author.isLocalAuthor('one', own)).toBe(false)
    wrapper.unmount()
  })

  it('captures queue publication but never upgrades peer or history to account identity', async () => {
    const chat = useChatStore()
    chat.sessions = [session('one', [message('history')])]
    chat.activeSessionId = 'one'
    chat.activeSession = chat.sessions[0]
    const { author, wrapper } = identity()
    await chat.sendMessage('initial')
    const queuedSend = chat.sendMessage('queued')
    const queued = chat.queuedUserMessages.get('one') || []
    expect(queued.length).toBe(1)
    expect(author.isLocalAuthor('one', queued[0])).toBe(true)
    await queuedSend
    expect(author.isLocalAuthor('one', { ...queued[0], queued: false })).toBe(true)
    chat.queuedUserMessages = new Map([['one', [...queued, message('peer-queue')]]])
    expect(author.isLocalAuthor('one', message('peer-queue'))).toBe(false)
    wrapper.unmount()
    const again = identity()
    expect(again.author.isLocalAuthor('one', queued[0])).toBe(true)
    again.wrapper.unmount()
    useAccountStore().$dispose()
    const disposed = identity()
    expect(disposed.author.isLocalAuthor('one', queued[0])).toBe(false)
    disposed.wrapper.unmount()
  })

  it('does not attach provenance to a peer publication after an empty action', async () => {
    const chat = useChatStore()
    chat.sessions = [session('one')]
    chat.activeSessionId = 'one'
    chat.activeSession = chat.sessions[0]
    const { author, wrapper } = identity()
    void chat.sendMessage('  ')
    chat.activeSession.messages.push(message('peer-after-empty'))
    expect(author.isLocalAuthor('one', message('peer-after-empty'))).toBe(false)
    wrapper.unmount()
  })

  it('captures an input when sendMessage creates a new session synchronously', async () => {
    const chat = useChatStore()
    const { author, wrapper } = identity()
    const sending = chat.sendMessage('new session input')
    const own = chat.messages.findLast(item => item.role === 'user')!
    expect(chat.activeSessionId).toBeTruthy()
    expect(author.isLocalAuthor(chat.activeSessionId || undefined, own)).toBe(true)
    await sending
    wrapper.unmount()
  })
})
