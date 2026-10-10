import { beforeEach, describe, expect, it, vi } from 'vitest'

const getModelCatalog = vi.hoisted(() => vi.fn())
vi.mock('../../packages/server/src/modules/studio/services/models/model-catalog', () => ({ getModelCatalog }))
import { resolveModelFastMode } from '../../packages/server/src/modules/studio/services/models/model-fast-mode'

const query = { provider: 'openai', model: 'gpt-6.1-sol', baseUrl: 'https://api.openai.com/v1', requestStyle: 'openai-responses' as const }
describe('provider-owned Fast capability', () => {
  beforeEach(() => { getModelCatalog.mockReturnValue(undefined) })
  it('uses exact official supported models when no catalog exists', () => {
    expect(resolveModelFastMode(query)).toBe(true)
    expect(resolveModelFastMode({ ...query, model: 'new-unverified-model' })).toBe(false)
    expect(resolveModelFastMode({ ...query, provider: 'custom:relay', baseUrl: 'https://relay.example/v1' })).toBe(false)
  })
  it('honors an explicit provider-specific disable', () => {
    getModelCatalog.mockReturnValue({ openai: { models: { 'gpt-6.1-sol': { fast_mode: false } } } })
    expect(resolveModelFastMode(query)).toBe(false)
  })
  it('allows trusted provider capability for a compatible custom endpoint', () => {
    getModelCatalog.mockReturnValue({ relay: { api: 'https://relay.example/v1', models: { custom: { fast_mode: true } } } })
    expect(resolveModelFastMode({ ...query, provider: 'custom:relay', model: 'custom', baseUrl: 'https://relay.example/v1' })).toBe(true)
  })
  it('does not borrow Fast through an ID-only catalog match', () => {
    getModelCatalog.mockReturnValue({ relay: { api: 'https://relay.example/v1', models: { custom: { fast_mode: true } } } })
    expect(resolveModelFastMode({ ...query, provider: 'custom:other', model: 'custom', baseUrl: 'https://other.example/v1' })).toBe(false)
  })
  it('keeps unsupported API styles disabled despite explicit model support', () => {
    expect(resolveModelFastMode({ ...query, requestStyle: 'anthropic-messages', fastModeOverride: true })).toBe(false)
  })
})
