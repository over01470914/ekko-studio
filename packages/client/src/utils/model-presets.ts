import type { AvailableModelGroup } from '@/api/hermes/system'
import type { ModelPreset } from '@/types/model-presets'
import { modelReasoningEfforts } from './model-reasoning-effort'

export const MAX_MODEL_PRESETS = 12

type PresetModelGroup = Pick<AvailableModelGroup, 'provider' | 'models' | 'model_meta'>

export function modelPresetIssue(step: ModelPreset, groups: PresetModelGroup[]): 'model' | 'reasoning' | null {
  const group = groups.find(group => group.provider === step.providerId)
  if (!group?.models.includes(step.modelId) || group.model_meta?.[step.modelId]?.disabled) return 'model'
  if (step.reasoningLevel && !modelReasoningEfforts(groups, step.providerId, step.modelId, []).includes(step.reasoningLevel)) {
    return 'reasoning'
  }
  return null
}

export function modelSupportsFastMode(groups: PresetModelGroup[], provider: string, model: string): boolean {
  const group = groups.find(group => group.provider === provider)
  const meta = group?.model_meta?.[model]
  return !!group?.models.includes(model) && !meta?.disabled && meta?.fast_mode === true
}

/** Structural parsing only: retain complete presets even when their model is now unavailable. */
export function normalizeModelPresets(value: unknown): ModelPreset[] {
  if (!Array.isArray(value)) return []
  const steps: ModelPreset[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const { id, label, providerId, modelId, reasoningLevel } = item
    if (![id, label, providerId, modelId].every(field => typeof field === 'string' && field.trim())) continue
    if (reasoningLevel !== undefined && typeof reasoningLevel !== 'string') continue
    const step: ModelPreset = { id: id.trim(), label: label.trim(), providerId: providerId.trim(), modelId: modelId.trim() }
    if (seen.has(step.id)) continue
    if (reasoningLevel?.trim()) step.reasoningLevel = reasoningLevel.trim()
    seen.add(step.id)
    steps.push(step)
    if (steps.length === MAX_MODEL_PRESETS) break
  }
  return steps
}

export function sameModelPresetCombination(a: Pick<ModelPreset, 'providerId' | 'modelId' | 'reasoningLevel'>,
  b: Pick<ModelPreset, 'providerId' | 'modelId' | 'reasoningLevel'> | null): boolean {
  return !!b && a.providerId === b.providerId && a.modelId === b.modelId && (a.reasoningLevel || '') === (b.reasoningLevel || '')
}
export function modelPresetIndex(presets: ModelPreset[], selection: ModelPreset | null): number {
  if (!selection) return -1
  const byId = presets.findIndex(preset => preset.id === selection.id && sameModelPresetCombination(preset, selection))
  return byId >= 0 ? byId : presets.findIndex(preset => sameModelPresetCombination(preset, selection))
}
