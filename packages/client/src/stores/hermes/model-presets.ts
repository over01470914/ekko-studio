import { defineStore } from 'pinia'
import { ref, onScopeDispose } from 'vue'
import { onAuthInvalidated } from '@/api/auth-invalidation'
import { decodeModelPresets, fetchModelPresets, persistModelPresets } from '@/api/hermes/model-presets'
import type { DisplayConfig } from '@/api/hermes/config'
import type { ModelPresetSettings } from '@/types/model-presets'
import { normalizeModelPresets } from '@/utils/model-presets'

const empty = (): ModelPresetSettings => ({ presets: [], defaultPresetId: '' })
const record = <T>(): Record<string, T> => Object.create(null)
const put = <T>(values: Record<string, T>, profile: string, value: T): Record<string, T> => Object.assign(record<T>(), values, { [profile]: value })
export const useModelPresetsStore = defineStore('modelPresets', () => {
  const byProfile = ref<Record<string, ModelPresetSettings>>(record())
  const loading = ref<Record<string, boolean>>(record())
  const errors = ref<Record<string, string>>(record())
  const saving = ref<Record<string, boolean>>(record())
  const pending = new Map<string, Promise<boolean>>()
  const versions = new Map<string, number>()
  const writes = new Map<string, object>()
  let generation = 0
  const revision = (profile: string) => `${generation}:${versions.get(profile) || 0}`
  const get = (profile: string) => Object.hasOwn(byProfile.value, profile) ? byProfile.value[profile]! : empty()
  const hasLoaded = (profile: string) => Object.hasOwn(byProfile.value, profile)
  function hydrate(profile: string, display: DisplayConfig, expectedRevision?: string) {
    if (!profile || (expectedRevision !== undefined && expectedRevision !== revision(profile)) || writes.has(profile)) return
    byProfile.value = put(byProfile.value, profile, decodeModelPresets(display))
  }
  async function load(profile: string, options: { force?: boolean } = {}): Promise<boolean> {
    if (!profile) return false
    if (writes.has(profile)) return hasLoaded(profile)
    if (pending.has(profile)) return pending.get(profile)!
    if (!options.force && hasLoaded(profile)) return true
    const currentGeneration = generation
    const currentVersion = revision(profile)
    loading.value = put(loading.value, profile, true)
    errors.value = put(errors.value, profile, '')
    const work = (async () => {
      try {
        const settings = await Promise.resolve().then(() => {
          if (currentGeneration !== generation) throw new Error('Preset load context changed')
          return fetchModelPresets(profile)
        })
        if (currentGeneration !== generation) return false
        if (currentVersion !== revision(profile) || writes.has(profile)) return hasLoaded(profile)
        byProfile.value = put(byProfile.value, profile, settings)
        return true
      } catch (error) {
        if (currentGeneration === generation && currentVersion === revision(profile)) errors.value = put(errors.value, profile, error instanceof Error ? error.message : String(error))
        return currentGeneration === generation && currentVersion !== revision(profile) && hasLoaded(profile)
      } finally {
        if (currentGeneration === generation) {
          pending.delete(profile)
          loading.value = put(loading.value, profile, false)
        }
      }
    })()
    pending.set(profile, work)
    return work
  }
  async function save(profile: string, settings: ModelPresetSettings) {
    if (!profile || writes.has(profile)) throw new Error('Preset save is already pending or has no profile')
    const presets = normalizeModelPresets(settings.presets)
    if (presets.length !== settings.presets.length || (settings.defaultPresetId && !presets.some(preset => preset.id === settings.defaultPresetId))) throw new Error('Invalid preset configuration')
    const snapshot = { presets, defaultPresetId: presets.length ? settings.defaultPresetId : '' }
    const currentGeneration = generation
    versions.set(profile, (versions.get(profile) || 0) + 1)
    const ticket = {}
    writes.set(profile, ticket)
    saving.value = put(saving.value, profile, true)
    try {
      await persistModelPresets(profile, snapshot)
      if (generation === currentGeneration) {
        byProfile.value = put(byProfile.value, profile, snapshot)
        errors.value = put(errors.value, profile, '')
      }
    } finally {
      if (writes.get(profile) === ticket) {
        writes.delete(profile)
        saving.value = put(saving.value, profile, false)
      }
    }
  }
  function clear() {
    generation++
    byProfile.value = record(); loading.value = record(); errors.value = record(); saving.value = record()
    pending.clear(); versions.clear(); writes.clear()
  }
  onScopeDispose(onAuthInvalidated(clear))
  return { get, hasLoaded, revision, hydrate, load, save, clear, loading, saving, errors }
})
