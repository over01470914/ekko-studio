import { computed, ref, watch, onMounted, onUnmounted, type Ref } from 'vue'
import { useChatStore } from '@/stores/hermes/chat'
import { useAppStore } from '@/stores/hermes/app'
import { useProfilesStore } from '@/stores/hermes/profiles'
import { useModelPresetsStore } from '@/stores/hermes/model-presets'
import { modelPresetIssue, sameModelPresetCombination } from '@/utils/model-presets'
import type { ModelPreset } from '@/types/model-presets'
import { commitModelPresetSelection, type PresetCommitResult, type PresetSelectionSnapshot } from '@/services/model-preset-selection'

export function useModelPresetPreview(disabled: Ref<boolean>, onFailure: (result: PresetCommitResult) => void) {
  const chat = useChatStore()
  const app = useAppStore()
  const profiles = useProfilesStore()
  const config = useModelPresetsStore()
  const anchor = ref<HTMLElement | null>(null)
  const open = ref(false)
  const committing = ref(false)
  const presets = ref<ModelPreset[]>([])
  const defaultPresetId = ref('')
  const preview = ref<ModelPreset | null>(null)
  const previewFast = ref(false)
  const loading = ref(false)
  const loadFailed = ref(false)
  const busy = computed(() => committing.value || chat.isApplyingModelPreset)
  const profile = computed(() => chat.activeSession?.profile || profiles.activeProfileName || 'default')
  const groups = computed(() => app.profileModelGroups.find(entry => entry.profile === profile.value)?.groups
    || (profile.value === (profiles.activeProfileName || 'default') ? app.modelGroups : []) || [])
  const issues = computed(() => Object.fromEntries(presets.value.map(preset => [preset.id, modelPresetIssue(preset, groups.value)])))
  const supportsFast = computed(() => !!chat.activeSession && !!preview.value && chat.sessionSupportsFastMode({
    ...chat.activeSession, provider: preview.value.providerId, model: preview.value.modelId,
    apiMode: chat.activeSession.provider === preview.value.providerId ? chat.activeSession.apiMode : undefined,
    baseUrl: chat.activeSession.provider === preview.value.providerId ? chat.activeSession.baseUrl : undefined,
  }))
  let before: PresetSelectionSnapshot | null = null
  let openingGeneration = 0
  const fastDraftByModel = new Map<string, boolean>()
  const modelKey = (preset: ModelPreset) => JSON.stringify([preset.providerId, preset.modelId])
  let touched = false
  let clickOpened = false
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  function clearCloseTimer() { if (closeTimer) clearTimeout(closeTimer); closeTimer = undefined }
  async function readPresets(force = false) {
    const ticket = openingGeneration
    const owner = before?.profile
    if (!owner) return
    loading.value = !config.hasLoaded(owner) || force
    const ok = await config.load(owner, { force })
    if (!open.value || ticket !== openingGeneration || owner !== profile.value) return
    loading.value = false
    loadFailed.value = !ok
    if (ok) {
      const saved = config.get(owner)
      // Freeze definitions/order for this opening so edits in another tab cannot
      // make a slider position silently select a different model mid-drag.
      if (!touched) presets.value = saved.presets.map(preset => ({ ...preset }))
      defaultPresetId.value = saved.defaultPresetId
    }
  }
  function openPanel() {
    clearCloseTimer()
    if (open.value || disabled.value || busy.value) return
    const session = chat.activeSession
    before = { sessionId: chat.activeSessionId, profile: profile.value,
      provider: session?.provider || app.selectedProvider || '', model: session?.model || app.selectedModel || '',
      reasoning: session?.reasoningEffort || '', fast: session?.fastMode === true }
    const saved = config.get(before.profile)
    presets.value = saved.presets.map(preset => ({ ...preset }))
    defaultPresetId.value = saved.defaultPresetId
    preview.value = { id: session?.modelPresetId || '__current', label: '', providerId: before.provider,
      modelId: before.model, reasoningLevel: before.reasoning || undefined }
    previewFast.value = before.fast
    fastDraftByModel.clear()
    fastDraftByModel.set(modelKey(preview.value), before.fast)
    touched = false; clickOpened = false; loadFailed.value = false
    openingGeneration++
    open.value = true
    void readPresets()
  }
  function select(index: number) {
    const preset = presets.value[index]
    if (!preset || issues.value[preset.id]) return
    if (preview.value) fastDraftByModel.set(modelKey(preview.value), previewFast.value)
    preview.value = { ...preset }
    previewFast.value = fastDraftByModel.get(modelKey(preset)) || false
    touched = true
  }
  function reset() { select(presets.value.findIndex(preset => preset.id === defaultPresetId.value)) }
  function toggleFast() {
    if (!supportsFast.value || !preview.value) return
    previewFast.value = !previewFast.value
    fastDraftByModel.set(modelKey(preview.value), previewFast.value)
  }
  async function closePanel(commit = true) {
    clearCloseTimer()
    if (!open.value) return
    open.value = false
    openingGeneration++
    const choice = preview.value && { ...preview.value }
    const snapshot = before
    const fast = previewFast.value && supportsFast.value
    if (!commit || disabled.value || !snapshot || !choice || snapshot.profile !== profile.value || chat.activeSessionId !== snapshot.sessionId) return
    if (touched) {
      const stillExists = config.get(snapshot.profile).presets.find(preset => preset.id === choice.id)
      if (!stillExists || !sameModelPresetCombination(stillExists, choice)) { onFailure('stale'); return }
    }
    committing.value = true
    try {
      const result = await commitModelPresetSelection(chat, snapshot, choice, fast, touched ? choice.id : undefined)
      if (result !== 'ok') onFailure(result)
    } catch { onFailure('selection-failed') }
    finally { committing.value = false }
  }
  function leave() { clearCloseTimer(); closeTimer = setTimeout(() => { void closePanel() }, 120) }
  function clickLauncher() {
    if (open.value && clickOpened) { void closePanel(); return }
    openPanel()
    if (open.value) clickOpened = true
  }
  function outside(event: PointerEvent) { if (open.value && !anchor.value?.contains(event.target as Node)) void closePanel() }
  function escape(event: KeyboardEvent) { if (open.value && event.key === 'Escape') { event.preventDefault(); void closePanel() } }
  watch(() => [chat.activeSessionId, profile.value], () => { if (open.value) void closePanel(false) })
  watch(disabled, value => { if (value) void closePanel(false) })
  onMounted(() => { document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape) })
  onUnmounted(() => { openingGeneration++; clearCloseTimer(); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) })
  return { anchor, open, committing, busy, presets, defaultPresetId, preview, previewFast, issues, supportsFast,
    loading, loadFailed, isStreaming: computed(() => chat.isStreaming), openPanel, closePanel, select, reset, toggleFast,
    clearCloseTimer, leave, clickLauncher, retry: () => readPresets(true) }
}
