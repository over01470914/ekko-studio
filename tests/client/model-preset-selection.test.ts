import { describe, expect, it, vi } from 'vitest'
import { commitModelPresetSelection } from '@/services/model-preset-selection'
const preset = { id: 'basic', label: 'basic', providerId: 'openai', modelId: 'sol' }
function port() {
  const api = { activeSessionId: 's' as string | null, activeSession: { id: 's', model: 'sol', provider: 'openai' } as any,
    newChat: vi.fn(), applyModelPreset: vi.fn(async () => true), setSessionFastMode: vi.fn(() => true) }
  return api
}
const before = { sessionId: 's', profile: 'A', model: 'sol', provider: 'openai', reasoning: '', fast: false }
describe('single final preset commit adapter', () => {
  it('has no model/Fast API writes for an unchanged preview', async () => {
    const api = port(); expect(await commitModelPresetSelection(api, before, preset, false)).toBe('ok')
    expect(api.applyModelPreset).not.toHaveBeenCalled(); expect(api.setSessionFastMode).not.toHaveBeenCalled()
  })
  it('applies a changed model/effort once before its final Fast state', async () => {
    const api = port(); const deep = { ...preset, id: 'deep', modelId: 'astra', reasoningLevel: 'medium' }
    await commitModelPresetSelection(api, before, deep, true, deep.id)
    expect(api.applyModelPreset).toHaveBeenCalledExactlyOnceWith('s', deep)
    expect(api.setSessionFastMode).toHaveBeenCalledExactlyOnceWith('s', true)
    expect(api.applyModelPreset.mock.invocationCallOrder[0]).toBeLessThan(api.setSessionFastMode.mock.invocationCallOrder[0])
    expect(api.activeSession.modelPresetId).toBe(deep.id)
  })
  it('does not apply Fast after a failed model/effort write', async () => {
    const api = port(); api.applyModelPreset.mockResolvedValueOnce(false)
    expect(await commitModelPresetSelection(api, before, { ...preset, reasoningLevel: 'high' }, true)).toBe('selection-failed')
    expect(api.setSessionFastMode).not.toHaveBeenCalled()
  })
  it('rejects a different active session without any side effects', async () => {
    const api = port(); api.activeSessionId = 'another'
    expect(await commitModelPresetSelection(api, before, preset, true)).toBe('stale')
    expect(api.setSessionFastMode).not.toHaveBeenCalled()
  })
  it('lets an explicit first-message preset override the newChat default reasoning', async () => {
    const api = port(); api.activeSessionId = null; api.activeSession = null as any
    api.newChat.mockImplementation(() => { api.activeSession = { id: 'draft', provider: 'openai', model: 'sol', reasoningEffort: 'high' }; return api.activeSession })
    expect(await commitModelPresetSelection(api, { ...before, sessionId: null }, preset, false, preset.id)).toBe('ok')
    expect(api.newChat).toHaveBeenCalledWith({ profile: 'A', model: 'sol', provider: 'openai' })
    expect(api.applyModelPreset).toHaveBeenCalledExactlyOnceWith('draft', preset)
  })
})
