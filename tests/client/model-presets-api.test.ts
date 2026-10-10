import { afterEach, describe, expect, it, vi } from 'vitest'
const request = vi.hoisted(() => vi.fn())
vi.mock('@/api/client', () => ({ request }))
import { invalidateAuth } from '@/api/auth-invalidation'
import { decodeModelPresets, fetchModelPresets, persistModelPresets } from '@/api/hermes/model-presets'
const preset = { id: 'deep', label: 'Deep', providerId: 'openai-codex', modelId: 'gpt-6.1-sol', reasoningLevel: 'high' }
afterEach(() => vi.useRealTimers())
afterEach(() => vi.useRealTimers())
describe('profile-scoped model presets adapter', () => {
  it('bounds optional auth/fetch stalls at ten seconds and aborts their signal', async () => {
    vi.useFakeTimers(); request.mockReturnValueOnce(new Promise(() => {}))
    const loading = fetchModelPresets('slow')
    const result = expect(loading).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(10_000)
    await result
    const [, options] = request.mock.calls.at(-1)!
    expect(options.signal.aborted).toBe(true)
  })

  it('loads the existing display keys using an explicit profile, not the current page or chat', async () => {
    request.mockResolvedValueOnce({ display: { composer_steps: [preset], composer_default_step_id: preset.id } })
    expect(await fetchModelPresets('other')).toEqual({ presets: [preset], defaultPresetId: preset.id })
    expect(request).toHaveBeenLastCalledWith('/api/hermes/config?section=display', expect.objectContaining({ headers: { 'X-Hermes-Profile': 'other' }, signal: expect.any(AbortSignal) }))
  })
  it('persists only preset keys, does not rewrite normal display fields or restart a gateway', async () => {
    await persistModelPresets('other', { presets: [preset], defaultPresetId: preset.id })
    const [path, options] = request.mock.calls.at(-1)!
    expect(path).toBe('/api/hermes/config')
    expect(options.headers).toEqual({ 'X-Hermes-Profile': 'other' })
    expect(JSON.parse(options.body)).toEqual({ section: 'display', values: { composer_steps: [preset], composer_default_step_id: preset.id }, restart: false })
  })
  it('clears a dangling default by id without assigning an arbitrary first model', () => {
    expect(decodeModelPresets({ composer_steps: [preset], composer_default_step_id: 'removed' })).toEqual({ presets: [preset], defaultPresetId: '' })
    expect(decodeModelPresets()).toEqual({ presets: [], defaultPresetId: '' })
  })
})

it('bounds an entire stalled preset request without blocking chat or leaking a late response', async () => {
  vi.useFakeTimers()
  request.mockReturnValueOnce(new Promise(() => {}))
  const loading = fetchModelPresets('other')
  const rejected = expect(loading).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(10_000)
  await rejected
  expect(request.mock.calls.at(-1)![1].signal.aborted).toBe(true)
})

it('invalidates an in-flight preset request when credentials or server context changes', async () => {
  request.mockReturnValueOnce(new Promise(() => {}))
  const loading = fetchModelPresets('other')
  const rejected = expect(loading).rejects.toThrow('authentication changed')
  await Promise.resolve()
  invalidateAuth()
  await rejected
  expect(request.mock.calls.at(-1)![1].signal.aborted).toBe(true)
})
it('does not dispatch a prepared save after auth changes before the request microtask', async () => {
  const count = request.mock.calls.length
  const saving = persistModelPresets('other', { presets: [preset], defaultPresetId: preset.id })
  const rejected = expect(saving).rejects.toThrow(/authentication changed|cancelled/)
  invalidateAuth()
  await rejected
  expect(request.mock.calls).toHaveLength(count)
})
