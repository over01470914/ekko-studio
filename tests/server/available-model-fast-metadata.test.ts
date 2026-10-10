import { beforeEach, describe, expect, it, vi } from 'vitest'
const catalog = vi.hoisted(() => ({ openai: { api: 'https://api.openai.com/v1', models: {
  'gpt-6.1-sol': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high'] }] },
} } }))
const resolve = vi.hoisted(() => vi.fn())
vi.mock('../../packages/server/src/modules/studio/public/model-catalog', async () => {
  const real = await import('../../packages/server/src/modules/studio/services/models/model-metadata')
  resolve.mockImplementation(real.resolveCatalogModel)
  return { getModelCatalog: () => catalog, resolveCatalogModel: resolve, catalogReasoningEfforts: real.catalogReasoningEfforts }
})
// This capability-only helper avoids another independent catalog lookup.
vi.mock('../../packages/server/src/modules/studio/public/model-fast-mode', async () => {
  const real = await import('../../packages/ekko-agent/src/model/fast-mode')
  return { modelSupportsFastMode: real.modelSupportsFastMode }
})
import { applyCatalogModelMetadata } from '../../packages/server/src/modules/hermes/services/models/metadata'
describe('model availability Fast metadata performance', () => {
  beforeEach(() => { resolve.mockClear() })
  it('reuses the reasoning resolution instead of traversing the catalog twice per model', () => {
    const result = applyCatalogModelMetadata([{ provider: 'openai', base_url: 'https://api.openai.com/v1', api_mode: 'codex_responses', models: ['gpt-6.1-sol', 'unknown'] }])
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(result[0].model_meta?.['gpt-6.1-sol']).toMatchObject({ reasoning_efforts: ['low', 'high'], fast_mode: true })
    expect(result[0].model_meta?.unknown).toBeUndefined()
  })
  it('does not borrow model-only Fast capability for an unrelated relay', () => {
    ;(catalog.openai.models['gpt-6.1-sol'] as any).fast_mode = true
    try {
      const result = applyCatalogModelMetadata([{ provider: 'custom:other', base_url: 'https://other.example/v1', api_mode: 'chat_completions', models: ['gpt-6.1-sol'] }])
      expect(result[0].model_meta?.['gpt-6.1-sol']?.fast_mode).not.toBe(true)
      expect(resolve).toHaveBeenCalledTimes(1)
    } finally { delete (catalog.openai.models['gpt-6.1-sol'] as any).fast_mode }
  })
})
