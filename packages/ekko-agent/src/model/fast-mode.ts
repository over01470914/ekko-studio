import type { ModelProviderConfig, ModelRequest, ModelRequestStyle } from './types'

/** Deliberately exact: future, pro, nano, Codex and fine-tuned IDs are not inferred. */
const OPENAI_FAST_MODE_MODELS = new Set([
  'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna',
  'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
  'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini',
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini',
  'gpt-4o-2024-05-13', 'o3', 'o4-mini',
])

export interface ModelFastModeQuery {
  provider?: string
  baseUrl?: string
  model: string
  requestStyle?: ModelRequestStyle
  /** Trusted per-model metadata, not a client-supplied send preference. */
  fastModeOverride?: boolean
}

/** OpenAI Fast pricing table + guide: https://developers.openai.com/api/docs/pricing
 * https://developers.openai.com/api/docs/guides/fast-mode
 * Compatible wire format alone says nothing about a provider's priority tier.
 */
export function modelSupportsFastMode(query: ModelFastModeQuery): boolean {
  if (query.requestStyle !== 'openai-chat' && query.requestStyle !== 'openai-responses') return false
  if (typeof query.fastModeOverride === 'boolean') return query.fastModeOverride
  let officialEndpoint = false
  try {
    const url = new URL(query.baseUrl || '')
    officialEndpoint = url.protocol === 'https:' && url.hostname === 'api.openai.com'
      && (url.pathname === '/v1' || url.pathname.startsWith('/v1/'))
  } catch {
    officialEndpoint = !query.baseUrl && ['openai', 'openai-api'].includes(query.provider || '')
  }
  return officialEndpoint && OPENAI_FAST_MODE_MODELS.has(query.model)
}

export function assertFastModeSupported(config: ModelProviderConfig, request: ModelRequest, requestStyle: ModelRequestStyle): void {
  if (request.fastMode !== undefined && typeof request.fastMode !== 'boolean') {
    throw Object.assign(new Error('fastMode must be a boolean'), { status: 400 })
  }
  const model = request.model ?? config.defaultModel
  if (request.fastMode === true && !modelSupportsFastMode({
    provider: config.id, baseUrl: config.baseUrl, model, requestStyle,
    fastModeOverride: config.modelMetadata?.[model]?.fast_mode,
  })) {
    throw Object.assign(new Error('Fast mode is not supported by the selected model/provider/API mode'), { status: 400 })
  }
}
