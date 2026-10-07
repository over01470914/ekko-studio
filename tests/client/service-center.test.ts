// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const api = vi.hoisted(() => ({
  fetchCatalog: vi.fn(), saveService: vi.fn(), deleteService: vi.fn(), setFavorite: vi.fn(), checkHealth: vi.fn(),
}))
const auth = vi.hoisted(() => ({ invalidate: (() => {}) as () => void }))
vi.mock('@/modules/studio-extensions/service-center/api', () => api)
vi.mock('@/modules/studio-extensions/service-center/host', () => ({ onServiceCenterReset: (callback: () => void) => { auth.invalidate = callback; return () => {} } }))
import { useServiceCenterStore } from '@/modules/studio-extensions/service-center/store'

const service = { id: 'sample', name: 'Sample', description: 'Browser UI', url: 'https://example.org/', icon: 'globe', category: 'Tools', tags: [], network: 'public', enabled: true, sortOrder: 0 }
const response = (revision = 1) => ({ revision, services: [service], favorites: [], health: {}, capabilities: { canManageServices: false, canManageEditors: false } })

describe('Service Center client store', () => {
  beforeEach(() => { vi.clearAllMocks(); setActivePinia(createPinia()); api.fetchCatalog.mockResolvedValue(response()) })
  it('loads capabilities from the server and updates favorites by service ID only', async () => {
    const store = useServiceCenterStore()
    await store.refresh()
    expect(store.catalog.capabilities.canManageServices).toBe(false)
    api.setFavorite.mockResolvedValue({ favorites: ['sample'] })
    await store.favorite('sample')
    expect(api.setFavorite).toHaveBeenCalledWith('sample', true)
    expect(store.catalog.favorites).toEqual(['sample'])
  })
  it('passes expected revision for save and delete and refetches the same runtime catalog', async () => {
    const store = useServiceCenterStore()
    await store.refresh()
    api.saveService.mockResolvedValue({ revision: 2 })
    api.fetchCatalog.mockResolvedValue(response(2))
    await store.save(service)
    expect(api.saveService).toHaveBeenCalledWith(1, service)
    expect(store.catalog.revision).toBe(2)
    api.deleteService.mockResolvedValue({ revision: 3 })
    await store.remove('sample')
    expect(api.deleteService).toHaveBeenCalledWith(2, 'sample')
  })
  it('clears previous identity data on auth invalidation and ignores late replies', async () => {
    const store = useServiceCenterStore()
    await store.refresh()
    let resolve!: (value: ReturnType<typeof response>) => void
    api.fetchCatalog.mockImplementation(() => new Promise(done => { resolve = done }))
    const pending = store.refresh()
    auth.invalidate()
    resolve(response(9))
    await pending
    expect(store.catalog.services).toEqual([])
    expect(store.catalog.capabilities.canManageEditors).toBe(false)
  })
  it('does not expose a stale catalog when refresh fails', async () => {
    const store = useServiceCenterStore()
    await store.refresh()
    api.fetchCatalog.mockRejectedValue(new Error('offline'))
    await store.refresh()
    expect(store.error).toBe('offline')
    expect(store.catalog.services).toEqual([])
  })
})