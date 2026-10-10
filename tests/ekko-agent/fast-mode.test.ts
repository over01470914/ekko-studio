import { describe, expect, it } from 'vitest'
import { modelSupportsFastMode } from '../../packages/ekko-agent/src/model/fast-mode'
import { toOpenAIChatPayload } from '../../packages/ekko-agent/src/model/providers/openai-compatible'
import { toOpenAIResponsesPayload } from '../../packages/ekko-agent/src/model/providers/openai-responses'
import type { ModelProviderConfig } from '../../packages/ekko-agent/src/model/types'

const config: ModelProviderConfig = { id: 'openai', type: 'openai-compatible', defaultModel: 'gpt-5.4', baseUrl: 'https://api.openai.com/v1', requestStyle: 'openai-chat' }
const request = { messages: [{ role: 'user' as const, content: 'Hello' }], reasoningEffort: 'high' as const }
describe('model-aware fast inference', () => {
  it('requires supported model, provider endpoint and wire protocol', () => {
    const query = { provider: 'openai', model: 'gpt-5.4', baseUrl: config.baseUrl, requestStyle: 'openai-chat' as const }
    expect(modelSupportsFastMode(query)).toBe(true)
    expect(modelSupportsFastMode({ ...query, model: 'unknown' })).toBe(false)
    expect(modelSupportsFastMode({ ...query, baseUrl: 'https://proxy.example/v1' })).toBe(false)
    expect(modelSupportsFastMode({ ...query, requestStyle: 'anthropic-messages' })).toBe(false)
    expect(modelSupportsFastMode({ ...query, fastModeOverride: false })).toBe(false)
    expect(modelSupportsFastMode({ ...query, model: 'custom', baseUrl: 'https://proxy.example/v1', fastModeOverride: true })).toBe(true)
  })
  it.each([false, undefined])('does not inject priority when fast is %s', fastMode => {
    expect(toOpenAIChatPayload(config, { ...request, fastMode }).service_tier).toBeUndefined()
    expect(toOpenAIResponsesPayload({ ...config, requestStyle: 'openai-responses' }, { ...request, fastMode }).service_tier).toBeUndefined()
  })
  it('sends priority to Chat Completions and Responses independently of reasoning', () => {
    const payload = toOpenAIChatPayload(config, { ...request, fastMode: true, stream: true })
    expect(payload).toMatchObject({ service_tier: 'priority', stream: true })
    expect(toOpenAIResponsesPayload({ ...config, requestStyle: 'openai-responses' }, { ...request, fastMode: true })).toMatchObject({ service_tier: 'priority', reasoning: { effort: 'high' } })
    expect(request.reasoningEffort).toBe('high')
  })
  it('rejects unsupported priority rather than exposing an empty toggle', () => {
    expect(() => toOpenAIChatPayload({ ...config, defaultModel: 'unknown' }, { ...request, fastMode: true })).toThrow(/Fast mode/)
    expect(() => toOpenAIResponsesPayload({ ...config, defaultModel: 'unknown' }, { ...request, fastMode: true })).toThrow(/Fast mode/)
  })
})
