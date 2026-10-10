<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NAlert, NButton, NInput, NSelect, NTag, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { AvailableModelGroup } from '@/api/hermes/system'
import { useModelPresetsStore } from '@/stores/hermes/model-presets'
import type { ModelPreset } from '@/types/model-presets'
import { modelPresetIssue, MAX_MODEL_PRESETS, normalizeModelPresets } from '@/utils/model-presets'
import { modelReasoningEfforts } from '@/utils/model-reasoning-effort'
import { generateClientUuid } from '@/utils/client-random'

const props = withDefaults(defineProps<{
  profile: string
  groups: AvailableModelGroup[]
  providersLoading?: boolean
}>(), { providersLoading: false })
const { t } = useI18n()
const message = useMessage()
const presetsStore = useModelPresetsStore()
const steps = ref<ModelPreset[]>([])
const defaultId = ref('')
const attemptedSave = ref(false)
const dirty = ref(false)
const hydrating = ref(false)
const ready = ref(false)
const loadFailed = ref(false)
const savingProfiles = ref<Record<string, boolean>>(Object.create(null))
const draggingId = ref('')
const saving = computed(() => !!savingProfiles.value[props.profile] || !!presetsStore.saving[props.profile])
const loading = computed(() => hydrating.value || !!presetsStore.loading[props.profile])
const blocked = computed(() => !props.profile || !ready.value || loading.value || saving.value || props.providersLoading)
const providerOptions = computed(() => props.groups.map(group => ({ label: group.label, value: group.provider })))
let generation = 0

function reset() {
  const saved = presetsStore.get(props.profile)
  // Copy the cache, never let v-model mutate another surface's saved presets.
  steps.value = saved.presets.map(step => ({ ...step }))
  defaultId.value = steps.value.some(step => step.id === saved.defaultPresetId) ? saved.defaultPresetId : ''
  attemptedSave.value = false
  dirty.value = false
  draggingId.value = ''
}
async function load(force = false) {
  const current = ++generation
  const profile = props.profile
  draggingId.value = ''
  steps.value = []
  defaultId.value = ''
  ready.value = false
  loadFailed.value = false
  attemptedSave.value = false
  if (!profile) { hydrating.value = false; return }
  hydrating.value = true
  if (presetsStore.hasLoaded(profile)) reset()
  try {
    const loaded = await presetsStore.load(profile, { force })
    if (current !== generation) return
    loadFailed.value = !loaded
    ready.value = loaded
    if (loaded) reset()
  } catch {
    if (current === generation) loadFailed.value = true
  } finally {
    if (current === generation) hydrating.value = false
  }
}
watch(() => props.profile, () => { void load() }, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => { generation++ })

watch(() => [presetsStore.get(props.profile), presetsStore.saving[props.profile]], () => {
  if (ready.value && !dirty.value && !loading.value && !saving.value) reset()
})
function edit() { dirty.value = true; draggingId.value = '' }
function issue(step: ModelPreset) { return modelPresetIssue(step, props.groups) }
function efforts(step: ModelPreset) {
  return modelReasoningEfforts(props.groups, step.providerId, step.modelId, [])
}
function reasoningOptions(step: ModelPreset) {
  const options = [{ label: t('composer.default'), value: '', disabled: false }, ...efforts(step).map(value => ({ label: value, value, disabled: false }))]
  if (step.reasoningLevel && !efforts(step).includes(step.reasoningLevel)) {
    options.push({ label: step.reasoningLevel, value: step.reasoningLevel, disabled: true })
  }
  return options
}
function providersFor(step: ModelPreset) {
  if (!step.providerId || providerOptions.value.some(option => option.value === step.providerId)) return providerOptions.value
  return [...providerOptions.value, { label: step.providerId, value: step.providerId, disabled: true }]
}
function modelsFor(step: ModelPreset) {
  const group = props.groups.find(group => group.provider === step.providerId)
  const options = (group?.models || []).map(value => ({
    label: group?.model_meta?.[value]?.alias || value,
    value,
    disabled: group?.model_meta?.[value]?.disabled === true,
  }))
  if (step.modelId && !options.some(option => option.value === step.modelId)) {
    options.push({ label: step.modelId, value: step.modelId, disabled: true })
  }
  return options
}
function changeProvider(step: ModelPreset, provider: string) {
  if (blocked.value) return
  step.providerId = provider
  step.modelId = ''
  delete step.reasoningLevel
  edit()
}
function changeModel(step: ModelPreset, model: string) {
  if (blocked.value) return
  step.modelId = model
  delete step.reasoningLevel
  edit()
}
function changeReasoning(step: ModelPreset, value: string) {
  if (blocked.value) return
  if (value) step.reasoningLevel = value
  else delete step.reasoningLevel
  edit()
}
function add() {
  if (blocked.value || steps.value.length >= MAX_MODEL_PRESETS) return
  steps.value.push({ id: generateClientUuid(), label: t('composer.custom'), providerId: '', modelId: '' })
  edit()
}
function remove(index: number) {
  if (blocked.value) return
  const [removed] = steps.value.splice(index, 1)
  if (removed?.id === defaultId.value || !steps.value.length) defaultId.value = ''
  edit()
}
function move(index: number, direction: number) {
  const next = index + direction
  if (blocked.value || next < 0 || next >= steps.value.length) return
  const [step] = steps.value.splice(index, 1)
  steps.value.splice(next, 0, step)
  edit()
}
function startDrag(event: DragEvent, id: string) {
  if (blocked.value) { event.preventDefault(); return }
  draggingId.value = id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }
}
function dragOver(event: DragEvent) {
  if (!blocked.value && draggingId.value) event.preventDefault()
}
function drop(event: DragEvent, targetId: string) {
  if (blocked.value || !draggingId.value) return
  event.preventDefault()
  const from = steps.value.findIndex(step => step.id === draggingId.value)
  const to = steps.value.findIndex(step => step.id === targetId)
  if (from >= 0 && to >= 0) move(from, to - from)
  draggingId.value = ''
}
async function save() {
  if (blocked.value) return
  attemptedSave.value = true
  const invalid = steps.value.find(step => !step.label.trim() || !step.providerId.trim() || !step.modelId.trim() || issue(step))
  if (invalid) {
    const problem = issue(invalid)
    message.error(t(problem === 'model' ? 'composer.invalidModel' : problem === 'reasoning' ? 'composer.invalidReasoning' : 'composer.saveFailed'))
    return
  }
  const profile = props.profile
  const current = generation
  const snapshot = { presets: normalizeModelPresets(steps.value), defaultPresetId: steps.value.length ? defaultId.value : '' }
  savingProfiles.value = Object.assign(Object.create(null), savingProfiles.value, { [profile]: true })
  draggingId.value = ''
  try {
    await presetsStore.save(profile, snapshot)
    // A save belongs to its original Profile and mount, even if it settles much later.
    if (current !== generation) return
    steps.value = snapshot.presets.map(step => ({ ...step }))
    defaultId.value = snapshot.defaultPresetId
    attemptedSave.value = false
    dirty.value = false
    message.success(t('composer.saved'))
  } catch {
    if (current === generation) message.error(t('composer.saveFailed'))
  } finally {
    savingProfiles.value = Object.assign(Object.create(null), savingProfiles.value, { [profile]: false })
  }
}
</script>

<template>
  <section class="composer-settings" data-testid="model-presets-panel" :aria-label="t('composer.modelPresetsTitle')" :aria-busy="loading || saving">
    <header class="composer-header">
      <NButton data-testid="composer-add" size="small" :disabled="blocked || steps.length >= MAX_MODEL_PRESETS" @click="add">
        {{ t('composer.add') }}
      </NButton>
    </header>
    <p class="hint">{{ t('composer.description') }}</p>
    <p class="hint">{{ t('composer.orderHint') }}</p>
    <p class="hint">{{ t('composer.fastModeHint') }} {{ t('composer.fastModeCostHint') }}</p>
    <NAlert v-if="loadFailed" type="error" :show-icon="false" data-testid="composer-load-error">
      {{ t('composer.loadFailed') }}
      <NButton data-testid="composer-retry" size="small" :disabled="loading || saving || !profile" @click="load(true)">{{ t('common.retry') }}</NButton>
    </NAlert>
    <p v-if="ready && !steps.length" data-testid="composer-empty" class="hint">{{ t('composer.empty') }}</p>
    <div v-for="(step, index) in steps" :key="step.id" class="composer-step" data-testid="composer-step" :data-preset-id="step.id" @dragover="dragOver" @drop="event => drop(event, step.id)">
      <div class="step-actions">
        <button type="button" class="drag-handle" data-testid="composer-drag-handle" :draggable="!blocked" :disabled="blocked" :aria-label="t('composer.reorder')" :title="t('composer.reorder')" @dragstart.stop="event => startDrag(event, step.id)" @dragend="draggingId = ''">⠿</button>
        <NButton data-testid="composer-default" size="small" :type="defaultId === step.id ? 'primary' : 'default'" :aria-pressed="defaultId === step.id" :disabled="blocked" @click="defaultId = step.id; edit()">
          {{ t('composer.newChatDefault') }}
        </NButton>
        <NButton data-testid="composer-up" size="small" :aria-label="t('composer.moveUp')" :disabled="blocked || index === 0" @click="move(index, -1)">{{ t('composer.moveUp') }}</NButton>
        <NButton data-testid="composer-down" size="small" :aria-label="t('composer.moveDown')" :disabled="blocked || index === steps.length - 1" @click="move(index, 1)">{{ t('composer.moveDown') }}</NButton>
        <NButton data-testid="composer-remove" size="small" :disabled="blocked" @click="remove(index)">{{ t('composer.remove') }}</NButton>
      </div>
      <div class="step-fields" @dragstart.prevent.stop>
        <label>
          <span>{{ t('composer.name') }}</span>
          <NInput v-model:value="step.label" data-testid="composer-name" :aria-label="t('composer.name')" :status="attemptedSave && !step.label.trim() ? 'error' : undefined" :disabled="blocked" @update:value="edit" />
        </label>
        <label>
          <span>{{ t('composer.provider') }}</span>
          <NSelect :value="step.providerId || null" data-testid="composer-provider" :aria-label="t('composer.provider')" :options="providersFor(step)" :disabled="blocked" @update:value="value => changeProvider(step, value)" />
        </label>
        <label>
          <span>{{ t('composer.model') }}</span>
          <NSelect :value="step.modelId || null" data-testid="composer-model" :aria-label="t('composer.model')" :options="modelsFor(step)" :disabled="blocked" @update:value="value => changeModel(step, value)" />
        </label>
        <label>
          <span>{{ t('composer.reasoning') }}</span>
          <NSelect :value="step.reasoningLevel || ''" data-testid="composer-reasoning" :aria-label="t('composer.reasoning')" :options="reasoningOptions(step)" :disabled="blocked || (!efforts(step).length && !step.reasoningLevel)" @update:value="value => changeReasoning(step, value)" />
        </label>
      </div>
      <NAlert v-if="!providersLoading && issue(step)" type="warning" :show-icon="false" class="step-warning" data-testid="composer-issue">
        {{ t(issue(step) === 'model' ? 'composer.invalidModel' : 'composer.invalidReasoning') }}
        <span v-if="issue(step) === 'reasoning'"> ({{ step.reasoningLevel }})</span>
        <NButton v-if="issue(step) === 'reasoning'" size="tiny" :disabled="blocked" @click="changeReasoning(step, '')">{{ t('composer.reset') }}</NButton>
      </NAlert>
    </div>
    <div v-if="steps.length" class="composer-preview" data-testid="composer-preview">
      <span>{{ t('composer.preview') }}</span>
      <NTag v-for="step in steps" :key="step.id" :type="issue(step) ? 'warning' : defaultId === step.id ? 'primary' : 'default'" :title="[step.providerId, step.modelId, step.reasoningLevel || t('composer.default')].join(' · ')">
        {{ step.label || t('composer.name') }} · {{ step.modelId }} · {{ step.reasoningLevel || t('composer.default') }}
      </NTag>
    </div>
    <p v-if="ready && steps.length && !defaultId" class="hint">{{ t('composer.noDefault') }}</p>
    <footer class="composer-footer">
      <NButton v-if="defaultId" data-testid="composer-clear-default" :disabled="blocked" @click="defaultId = ''; edit()">{{ t('composer.clearNewChatDefault') }}</NButton>
      <NButton data-testid="composer-reset" :disabled="blocked" @click="reset">{{ t('composer.reset') }}</NButton>
      <NButton data-testid="composer-save" type="primary" :loading="saving" :disabled="blocked" @click="save">{{ t('composer.save') }}</NButton>
    </footer>
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;
.composer-settings { padding: 16px; margin-bottom: 14px; border: 1px solid $border-color; border-radius: $radius-md; background: $bg-card; }
.composer-header, .step-actions, .composer-footer, .composer-preview { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.composer-header { justify-content: flex-end; }
.drag-handle { cursor: grab; color: $text-secondary; background: transparent; border: 1px solid $border-color; border-radius: $radius-md; padding: 4px 8px; font-size: 18px; line-height: 1; &:active { cursor: grabbing; } &:disabled { cursor: not-allowed; opacity: .5; } }
.hint { color: $text-secondary; font-size: 12px; line-height: 1.6; }
.composer-step { padding: 12px 0; border-top: 1px solid $border-color; }
.step-actions, .step-warning { margin-bottom: 10px; }
.step-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; label { min-width: 0; display: flex; flex-direction: column; gap: 6px; font-size: 12px; } }
.step-warning { margin-top: 10px; }
.composer-preview { padding: 12px 0; .n-tag { max-width: 100%; } }
.composer-footer { justify-content: flex-end; margin-top: 12px; }
@media (max-width: 600px) { .step-fields { grid-template-columns: minmax(0, 1fr); } }
</style>
