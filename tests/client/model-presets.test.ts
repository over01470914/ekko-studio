import { describe, expect, it } from 'vitest'
import { modelPresetIssue, MAX_MODEL_PRESETS, modelSupportsFastMode, normalizeModelPresets } from '@/utils/model-presets'
import type { ModelPreset } from '@/types/model-presets'

const step: ModelPreset = { id: 'one', label: 'Work', providerId: 'work', modelId: 'think' }
const groups = [
  { provider: 'work', models: ['think', 'plain', 'unknown', 'disabled', 'empty'], model_meta: {
    think: { reasoning: true, reasoning_efforts: ['low', 'high'], fast_mode: true },
    plain: { reasoning: false, reasoning_efforts: ['high'], fast_mode: false },
    disabled: { disabled: true, reasoning_efforts: ['high'], fast_mode: true },
    empty: { reasoning: true, reasoning_efforts: [] },
    missing: { fast_mode: true },
  } },
  { provider: 'other', models: ['think'], model_meta: { think: { reasoning_efforts: ['medium'] } } },
]

describe('Composer model capabilities', () => {
  it('accepts no override and only model-specific supported reasoning overrides', () => {
    expect(modelPresetIssue(step, groups)).toBeNull()
    expect(modelPresetIssue({ ...step, reasoningLevel: 'high' }, groups)).toBeNull()
    expect(modelPresetIssue({ ...step, reasoningLevel: 'max' }, groups)).toBe('reasoning')
    expect(modelPresetIssue({ ...step, providerId: 'other', reasoningLevel: 'high' }, groups)).toBe('reasoning')
  })
  it.each(['plain', 'unknown', 'empty'])('does not infer all reasoning levels for %s', modelId => {
    expect(modelPresetIssue({ ...step, modelId }, groups)).toBeNull()
    expect(modelPresetIssue({ ...step, modelId, reasoningLevel: 'high' }, groups)).toBe('reasoning')
  })
  it('rejects missing providers, missing models and disabled models before reasoning', () => {
    expect(modelPresetIssue({ ...step, providerId: 'missing' }, groups)).toBe('model')
    expect(modelPresetIssue({ ...step, modelId: 'missing' }, groups)).toBe('model')
    expect(modelPresetIssue({ ...step, modelId: 'disabled', reasoningLevel: 'high' }, groups)).toBe('model')
  })
  it('requires an existing enabled model and explicit fast_mode true', () => {
    expect(modelSupportsFastMode(groups, 'work', 'think')).toBe(true)
    for (const model of ['plain', 'unknown', 'disabled', 'missing']) {
      expect(modelSupportsFastMode(groups, 'work', model)).toBe(false)
    }
    expect(modelSupportsFastMode(groups, 'other', 'think')).toBe(false)
    expect(modelSupportsFastMode(groups, 'missing', 'think')).toBe(false)
  })
})

describe('normalizeModelPresets', () => {
  it.each([undefined, null, {}, '[]', 1])('safely handles non-array input %s', value => {
    expect(normalizeModelPresets(value)).toEqual([])
  })
  it('skips malformed and incomplete fields, trims and deduplicates IDs', () => {
    expect(normalizeModelPresets([
      null, [], {}, { ...step, label: ' ' }, { ...step, modelId: 2 }, { ...step, reasoningLevel: 5 },
      { ...step, id: ' one ', label: ' Work ', reasoningLevel: ' high ', fastMode: true },
      { ...step, label: 'Duplicate' }, { ...step, id: 'two', reasoningLevel: '' },
    ])).toEqual([{ ...step, reasoningLevel: 'high' }, { ...step, id: 'two' }])
  })
  it('caps complete unique steps at 12 without counting rejected entries', () => {
    const input = [{ ...step, id: '' }, ...Array.from({ length: 20 }, (_, index) => ({ ...step, id: String(index) }))]
    const result = normalizeModelPresets(input)
    expect(result).toHaveLength(MAX_MODEL_PRESETS)
    expect(result.map(step => step.id)).toEqual(Array.from({ length: 12 }, (_, index) => String(index)))
  })
  it('retains complete unavailable presets and invalid reasoning for repair without mutating input', () => {
    const invalid = Object.freeze({ ...step, modelId: 'deleted', reasoningLevel: 'unsupported' })
    expect(normalizeModelPresets([invalid])).toEqual([invalid])
    expect(normalizeModelPresets([invalid])[0]).not.toBe(invalid)
  })
})
