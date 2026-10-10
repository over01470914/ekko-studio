/** A saved user-defined model/reasoning preset. Fast mode is a separate, model-capability-based toggle. */
export interface ModelPreset {
  id: string
  label: string
  providerId: string
  modelId: string
  reasoningLevel?: string
}

export interface ModelPresetSettings {
  presets: ModelPreset[]
  defaultPresetId: string
}
