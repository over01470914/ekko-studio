// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const api = vi.hoisted(() => ({
  fetchCatalog: vi.fn(), saveService: vi.fn(), deleteService: vi.fn(), setFavorite: vi.fn(), checkHealth: vi.fn(),
}))
const auth = vi.hoisted(() => ({ invalidate: (() => {}) as () => void }))
vi.mock('@/modules/studio-extensions/service-center/api', async () => ({
  ...await vi.importActual('@/modules/studio-extensions/service-center/api'), ...api,
}))
vi.mock('@/modules/studio-extensions/service-center/host', () => ({ onServiceCenterReset: (callback: () => void) => { auth.invalidate = callback; return () => {} } }))
import { useServiceCenterStore } from '@/modules/studio-extensions/service-center/store'
import { serviceCenterMessages } from '@/modules/studio-extensions/service-center/messages'
import { sc02Localized } from '@/modules/studio-extensions/service-center/sc02-locales'
import { selectedEntrance, type ServiceEntry } from '@/modules/studio-extensions/service-center/api'

const service = { id: 'sample', name: 'Sample', description: 'Browser UI', icon: 'globe', categoryId: null, nodeId: null, tags: [], endpoints: [{ id: 'primary', label: 'Web', url: 'https://example.org/', network: 'public', login: 'unknown' }], defaultEndpointId: 'primary', enabled: true, sortOrder: 0 }
const response = (revision = 1) => ({ schemaVersion: 2, revision, categories: [], nodes: [], services: [service], favorites: [], health: {}, capabilities: { canManageServices: false, canManageEditors: false } })

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

describe('Service Center v2 locale ownership', () => {
  it('resolves a surviving default after the selected entrance is deleted without guessing its network', () => {
    const hostOnly = { ...service, endpoints: [{ ...service.endpoints[0], network: 'local' }], defaultEndpointId: 'primary' } as ServiceEntry
    expect(selectedEntrance(hostOnly, 'removed')?.id).toBe('primary')
    expect(selectedEntrance(hostOnly, 'removed')?.network).toBe('local')
    expect(selectedEntrance(hostOnly)?.network).toBe('local')
    expect(selectedEntrance({ ...hostOnly, endpoints: [] }, 'removed')).toBeUndefined()
  })
  it('provides new panel, entrance and host-only network copy in every supported locale', () => {
    expect(Object.keys(serviceCenterMessages)).toHaveLength(11)
    for (const locale of Object.keys(sc02Localized) as Array<keyof typeof sc02Localized>) {
      const messages = serviceCenterMessages[locale]
      expect(messages.legend).toBe(sc02Localized[locale].legend)
      expect(messages.manageOrganization).toBe(sc02Localized[locale].manageOrganization)
      expect(messages.invalidEntrances).toBe(sc02Localized[locale].invalidEntrances)
      expect(messages.network.local).toBe(sc02Localized[locale].networkLocal)
      expect(messages.legendNetwork.local).toBe(sc02Localized[locale].legendNetwork.local)
      expect(messages.login).toEqual(sc02Localized[locale].login)
      expect(messages.health.stale).toBe(sc02Localized[locale].healthStale)
      expect(messages.network.local).not.toBe('This device')
      expect(messages.login.unknown).not.toBe('Login unknown')
    }
  })
})