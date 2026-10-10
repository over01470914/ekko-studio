import { request } from '../client'
import { onAuthInvalidated } from '../auth-invalidation'
import type { DisplayConfig } from './config'
import type { ModelPresetSettings } from '@/types/model-presets'
import { normalizeModelPresets } from '@/utils/model-presets'

/** Storage adapter: preserve existing profile display keys without exposing them to UI. */
export function decodeModelPresets(display: DisplayConfig = {}): ModelPresetSettings {
  const presets = normalizeModelPresets(display.composer_steps)
  const defaultPresetId = presets.some(preset => preset.id === display.composer_default_step_id)
    ? display.composer_default_step_id! : ''
  return { presets, defaultPresetId }
}
/** Bounds this optional request including desktop-auth readiness, without changing the shared client/r3 transport. */
async function presetRequest<T>(path: string, options: RequestInit): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let unsubscribe = () => {}
  const invalidated = new Promise<never>((_, reject) => {
    unsubscribe = onAuthInvalidated(() => { controller.abort(); reject(new Error('Model presets authentication changed')) })
  })
  const deadline = new Promise<T>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Model presets request timed out')) }, 10_000)
  })
  try {
    return await Promise.race([Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error('Model presets request cancelled')
      return request<T>(path, { ...options, signal: controller.signal })
    }), deadline, invalidated])
  } finally { if (timer) clearTimeout(timer); unsubscribe() }
}
export async function fetchModelPresets(profile: string): Promise<ModelPresetSettings> {
  const data = await presetRequest<{ display?: DisplayConfig }>('/api/hermes/config?section=display', {
    headers: { 'X-Hermes-Profile': profile },
  })
  return decodeModelPresets(data.display)
}
export async function persistModelPresets(profile: string, settings: ModelPresetSettings): Promise<void> {
  await presetRequest('/api/hermes/config', {
    method: 'PUT', headers: { 'X-Hermes-Profile': profile },
    body: JSON.stringify({ section: 'display', values: {
      composer_steps: settings.presets, composer_default_step_id: settings.defaultPresetId,
    }, restart: false }),
  })
}
