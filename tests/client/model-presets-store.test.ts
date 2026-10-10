// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
const api = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn() }))
vi.mock('@/api/hermes/model-presets', async importOriginal => ({ ...await importOriginal<typeof import('@/api/hermes/model-presets')>(), fetchModelPresets: api.fetch, persistModelPresets: api.save }))
import { useModelPresetsStore } from '@/stores/hermes/model-presets'
import { invalidateAuth } from '@/api/auth-invalidation'
const p = { id: 'p', label: 'Deep', providerId: 'openai', modelId: 'sol', reasoningLevel: 'high' }
const saved = { presets: [p], defaultPresetId: p.id }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
beforeEach(() => { vi.resetAllMocks(); setActivePinia(createPinia()); localStorage.clear(); api.save.mockResolvedValue(undefined) })
describe('model presets profile cache and concurrency', () => {
  it('treats valid profile names like constructor as ordinary cache keys', async () => {
    const store = useModelPresetsStore(); api.fetch.mockResolvedValueOnce(saved)
    expect(store.hasLoaded('constructor')).toBe(false)
    expect(store.get('constructor').presets).toEqual([])
    expect(store.loading.constructor).toBeUndefined()
    await store.load('constructor')
    expect(store.get('constructor')).toEqual(saved)
  })

  it('can hydrate from existing startup settings with no new network request', () => {
    const store = useModelPresetsStore(); store.hydrate('default', { composer_steps: [p], composer_default_step_id: p.id })
    expect(store.get('default')).toEqual(saved); expect(store.hasLoaded('default')).toBe(true); expect(api.fetch).not.toHaveBeenCalled()
  })
  it('separates profile B from the active chat profile A and deduplicates loads', async () => {
    localStorage.setItem('hermes_active_profile_name', 'A')
    const pending = deferred<typeof saved>(); api.fetch.mockReturnValue(pending.promise)
    const store = useModelPresetsStore(); store.hydrate('A', { composer_steps: [], composer_default_step_id: '' })
    const one = store.load('B'); const two = store.load('B')
    await Promise.resolve(); expect(api.fetch).toHaveBeenCalledOnce(); expect(api.fetch).toHaveBeenCalledWith('B')
    pending.resolve(saved); await Promise.all([one, two])
    expect(store.get('B')).toEqual(saved); expect(store.get('A').presets).toEqual([])
    expect(localStorage.getItem('hermes_active_profile_name')).toBe('A')
    await store.load('B'); expect(api.fetch).toHaveBeenCalledOnce()
  })
  it('keeps user order and stable default identity when saving', async () => {
    const store = useModelPresetsStore(); const basic = { ...p, id: 'basic', modelId: 'luna', reasoningLevel: 'medium' }
    await store.save('B', { presets: [p, basic], defaultPresetId: basic.id })
    expect(store.get('B').presets.map(x => x.id)).toEqual(['p', 'basic']); expect(store.get('B').defaultPresetId).toBe('basic')
    expect(api.save).toHaveBeenCalledWith('B', { presets: [p, basic], defaultPresetId: basic.id })
  })
  it('does not let an old GET overwrite a completed save', async () => {
    const d = deferred<typeof saved>(); api.fetch.mockReturnValue(d.promise)
    const store = useModelPresetsStore(); const load = store.load('A'); await Promise.resolve()
    await store.save('A', { presets: [], defaultPresetId: '' }); d.resolve(saved); await expect(load).resolves.toBe(true)
    expect(store.get('A').presets).toEqual([]); expect(store.loading.A).toBe(false)
  })
  it('does not let late generic settings hydration overwrite a newer save', async () => {
    const store = useModelPresetsStore(); const stamp = store.revision('A')
    await store.save('A', { presets: [], defaultPresetId: '' })
    store.hydrate('A', { composer_steps: [p], composer_default_step_id: p.id }, stamp)
    expect(store.get('A').presets).toEqual([])
  })
  it('preserves cache on a failed save and rejects overlapping writes', async () => {
    const store = useModelPresetsStore(); store.hydrate('A', { composer_steps: [p], composer_default_step_id: p.id })
    api.save.mockRejectedValueOnce(new Error('failure')); await expect(store.save('A', { presets: [], defaultPresetId: '' })).rejects.toThrow('failure')
    expect(store.get('A')).toEqual(saved)
    const d = deferred<void>(); api.save.mockReturnValue(d.promise)
    const save = store.save('A', saved); await expect(store.save('A', saved)).rejects.toThrow('pending'); d.resolve(); await save
  })
  it('clears cache on auth invalidation and rejects old load/hydrate continuations', async () => {
    const store = useModelPresetsStore(); const d = deferred<typeof saved>(); api.fetch.mockReturnValue(d.promise)
    const stamp = store.revision('A'); const load = store.load('A'); await Promise.resolve(); invalidateAuth(); d.resolve(saved); await load
    store.hydrate('A', { composer_steps: [p] }, stamp)
    expect(store.hasLoaded('A')).toBe(false)
  })
  it('reports load errors without claiming an empty response is loaded', async () => {
    const store = useModelPresetsStore(); api.fetch.mockRejectedValueOnce(new Error('offline'))
    expect(await store.load('A')).toBe(false); expect(store.errors.A).toBe('offline'); expect(store.hasLoaded('A')).toBe(false)
  })
})
