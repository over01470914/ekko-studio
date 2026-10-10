import { beforeEach, describe, expect, it, vi } from 'vitest'
const resolveCatalogModel = vi.hoisted(() => vi.fn())
const getModelCatalog = vi.hoisted(() => vi.fn())
vi.mock('../../packages/server/src/modules/studio/public/model-catalog', () => ({
  getModelCatalog, resolveCatalogModel,
  catalogReasoningEfforts: (model: any) => model?.reasoning_efforts,
}))
import { applyCatalogModelMetadata } from '../../packages/server/src/modules/hermes/services/models/metadata'

describe('composer capability enrichment startup work', () => {
  beforeEach(() => { vi.clearAllMocks(); getModelCatalog.mockReturnValue({}); resolveCatalogModel.mockReturnValue(undefined) })
  it('resolves each model only once for both reasoning and Fast', () => {
    resolveCatalogModel.mockReturnValue({ matchedBy: 'provider', model: { reasoning: true, reasoning_efforts: ['low', 'high'], fast_mode: true } })
    const groups = [{ provider: 'custom:relay', base_url: 'https://relay.example/v1', models: ['a', 'b', 'c'] }]
    const result = applyCatalogModelMetadata(groups)
    expect(resolveCatalogModel).toHaveBeenCalledTimes(3)
    expect(getModelCatalog).toHaveBeenCalledTimes(1)
    expect(result[0].model_meta).toMatchObject({ a: { fast_mode: true, reasoning_efforts: ['low', 'high'] }, b: { fast_mode: true } })
  })
  it('never borrows Fast support from an ID-only catalog match', () => {
    resolveCatalogModel.mockReturnValue({ matchedBy: 'model', model: { reasoning: true, fast_mode: true } })
    const result = applyCatalogModelMetadata([{ provider: 'custom:other', base_url: 'https://other.example/v1', models: ['a'] }])
    expect(result[0].model_meta?.a.fast_mode).toBeUndefined()
    expect(result[0].model_meta?.a.reasoning).toBe(true)
  })
  it('performs no catalog scans when the catalog is unavailable', () => {
    getModelCatalog.mockReturnValue(undefined)
    const result = applyCatalogModelMetadata([{ provider: 'openai', base_url: 'https://api.openai.com/v1', models: ['gpt-6.1-sol'] }])
    expect(resolveCatalogModel).not.toHaveBeenCalled()
    expect(result[0].model_meta?.['gpt-6.1-sol'].fast_mode).toBe(true)
  })
})
