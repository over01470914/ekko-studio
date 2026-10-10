// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'

const api = vi.hoisted(() => ({ fetchCurrentUser: vi.fn(), fetchMyAvatar: vi.fn() }))
const credentials = vi.hoisted(() => ({ username: 'cached-name' }))
vi.mock('@/api/studio/auth', () => api)
vi.mock('@/api/client', () => ({ getStoredUsername: () => credentials.username }))

import { useAccountStore } from '@/stores/account'
import { invalidateAuth } from '@/api/auth-invalidation'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

describe('shared account identity', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    credentials.username = 'cached-name'
  })

  it('shares one load across sidebar and settings and retains account edits on remount', async () => {
    api.fetchCurrentUser.mockResolvedValue({ username: 'server-name' })
    api.fetchMyAvatar.mockResolvedValue({ type: 'image', dataUrl: 'data:image/png;base64,fixture' })
    const sidebar = useAccountStore()
    const settings = useAccountStore()
    await Promise.all([sidebar.loadAccount(), settings.loadAccount()])
    expect(api.fetchCurrentUser).toHaveBeenCalledTimes(1)
    expect(api.fetchMyAvatar).toHaveBeenCalledTimes(1)
    expect(sidebar.username).toBe('server-name')
    expect(sidebar.profileAvatar?.dataUrl).toBe('data:image/png;base64,fixture')

    const { username, avatar } = storeToRefs(settings)
    username.value = 'renamed'
    avatar.value = { type: 'default' }
    await sidebar.loadAccount()
    expect(sidebar.username).toBe('renamed')
    expect(sidebar.profileAvatar).toBeNull()
    expect(api.fetchCurrentUser).toHaveBeenCalledTimes(1)
  })

  it('keeps a usable identity on load failure and retries on the next mount', async () => {
    api.fetchCurrentUser.mockRejectedValueOnce(new Error('offline'))
    api.fetchMyAvatar.mockResolvedValue(null)
    const account = useAccountStore()
    await account.loadAccount()
    expect(account.username).toBe('cached-name')
    expect(account.profileAvatar).toBeNull()
    api.fetchCurrentUser.mockResolvedValue({ username: 'recovered' })
    await account.loadAccount()
    expect(account.username).toBe('recovered')
  })

  it('invalidates stale fulfillment and finally without erasing the newer pending load', async () => {
    const oldUser = deferred<{ username: string }>()
    const newUser = deferred<{ username: string }>()
    api.fetchCurrentUser.mockReturnValueOnce(oldUser.promise).mockReturnValueOnce(newUser.promise)
    api.fetchMyAvatar.mockResolvedValue({ type: 'default' })
    const account = useAccountStore()
    const stale = account.loadAccount()
    credentials.username = 'next-account'
    invalidateAuth()
    expect(account.username).toBe('next-account')
    const fresh = account.loadAccount()
    void account.loadAccount()
    expect(api.fetchCurrentUser).toHaveBeenCalledTimes(2)
    oldUser.resolve({ username: 'stale-account' })
    await stale
    expect(account.username).toBe('next-account')
    void account.loadAccount()
    expect(api.fetchCurrentUser).toHaveBeenCalledTimes(2)
    newUser.resolve({ username: 'fresh-account' })
    await fresh
    expect(account.username).toBe('fresh-account')
    expect(api.fetchCurrentUser).toHaveBeenCalledTimes(2)
  })

  it('does not overwrite newer local username/avatar edits with an earlier response', async () => {
    const user = deferred<{ username: string }>()
    const avatar = deferred<{ type: 'image'; dataUrl: string }>()
    api.fetchCurrentUser.mockReturnValue(user.promise)
    api.fetchMyAvatar.mockReturnValue(avatar.promise)
    const account = useAccountStore()
    const loading = account.loadAccount()
    account.username = 'renamed-here'
    account.avatar = { type: 'image', dataUrl: 'data:image/png;base64,new' }
    user.resolve({ username: 'older-server-name' })
    avatar.resolve({ type: 'image', dataUrl: 'data:image/png;base64,old' })
    await loading
    expect(account.username).toBe('renamed-here')
    expect(account.profileAvatar?.dataUrl).toBe('data:image/png;base64,new')
    account.avatar = { type: 'default' }
    expect(account.profileAvatar).toBeNull()
  })

  it('leaves ordinary forbidden/offline failures retryable without invalidating the account', async () => {
    api.fetchCurrentUser.mockRejectedValueOnce({ status: 403 }).mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ username: 'recovered' })
    api.fetchMyAvatar.mockResolvedValue({ type: 'default' })
    const account = useAccountStore()
    await account.loadAccount()
    expect(account.username).toBe('cached-name')
    await account.loadAccount()
    expect(account.username).toBe('cached-name')
    await account.loadAccount()
    expect(account.username).toBe('recovered')
  })

  it('discards a pending response when disposed', async () => {
    const oldUser = deferred<{ username: string }>()
    api.fetchCurrentUser.mockReturnValue(oldUser.promise)
    api.fetchMyAvatar.mockResolvedValue(null)
    const account = useAccountStore()
    const loading = account.loadAccount()
    account.$dispose()
    oldUser.resolve({ username: 'old-account' })
    await loading
    expect(account.username).toBe('cached-name')
  })
})
