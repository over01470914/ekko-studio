import { modelSupportsFastMode } from '../../../studio/public/model-fast-mode'
import { getModelCatalog, resolveCatalogModel, catalogReasoningEfforts } from '../../../studio/public/model-catalog'

interface CatalogModelGroup {
  provider: string
  base_url: string
  models: string[]
  api_mode?: string
  model_meta?: Record<string, { fast_mode?: boolean; reasoning?: boolean; reasoning_efforts?: string[] }>
}

export function applyCatalogModelMetadata<T extends CatalogModelGroup>(groups: T[]): T[] {
  const catalog = getModelCatalog()
  return groups.map(group => {
    const meta = { ...group.model_meta }
    for (const id of group.models) {
      const match = catalog ? resolveCatalogModel(catalog, { provider: group.provider, baseUrl: group.base_url, model: id }) : undefined
      const model = match?.model
      const requestStyle = group.api_mode === 'codex_responses' ? 'openai-responses'
        : !group.api_mode || group.api_mode === 'chat_completions' ? 'openai-chat' : undefined
      const fastMode = modelSupportsFastMode({ provider: group.provider, baseUrl: group.base_url, model: id, requestStyle,
        // Reuse the reasoning lookup; resolving the entire catalog again for Fast
        // doubles startup work across every profile/provider/model.
        fastModeOverride: meta[id]?.fast_mode ?? (match?.matchedBy !== 'model' ? model?.fast_mode : undefined) })
      if (!model && !fastMode) continue
      const efforts = catalogReasoningEfforts(model)
      meta[id] = {
        ...meta[id],
        ...(fastMode ? { fast_mode: true } : {}),
        ...(typeof model?.reasoning === 'boolean' ? { reasoning: model.reasoning } : {}),
        ...(efforts !== undefined ? { reasoning_efforts: efforts } : {}),
      }
    }
    return Object.keys(meta).length ? { ...group, model_meta: meta } : group
  })
}
