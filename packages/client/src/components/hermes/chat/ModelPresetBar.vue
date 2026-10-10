<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { NTooltip } from 'naive-ui'
import type { ModelPreset } from '@/types/model-presets'
import { modelPresetIndex } from '@/utils/model-presets'
const props = defineProps<{
  presets: ModelPreset[]; preview: ModelPreset | null; defaultPresetId: string;
  fast: boolean; supportsFast: boolean; issues: Record<string, 'model' | 'reasoning' | null>;
  loading?: boolean; loadFailed?: boolean; isStreaming?: boolean;
}>()
const emit = defineEmits<{ select: [index: number]; fast: []; reset: []; manage: []; retry: [] }>()
const { t } = useI18n()
const effortLabel = (value?: string) => t(`chat.reasoningEffort.options.${value || 'default'}`)
const index = computed(() => modelPresetIndex(props.presets, props.preview))
const label = computed(() => index.value >= 0 ? props.presets[index.value]!.label : t('composer.custom'))
const selectionText = computed(() => `${label.value} · ${props.preview?.providerId}/${props.preview?.modelId} · ${effortLabel(props.preview?.reasoningLevel)}`)
const style = computed(() => ({ '--preset-count': String(props.presets.length || 1), '--preset-progress': `${index.value < 0 || props.presets.length < 2 ? 0 : index.value / (props.presets.length - 1) * 100}%` }))
function title(preset: ModelPreset) {
  const issue = props.issues[preset.id]
  return `${preset.label} · ${preset.providerId}/${preset.modelId} · ${effortLabel(preset.reasoningLevel)}${issue ? ` — ${t(issue === 'model' ? 'composer.invalidModel' : 'composer.invalidReasoning')}` : ''}`
}
function selectFromInput(event: Event) {
  const target = event.target as HTMLInputElement
  emit('select', Number(target.value))
  // Invalid positions must not leave a thumb pretending to select another model.
  void nextTick(() => { target.value = String(Math.max(index.value, 0)) })
}
</script>
<template>
  <div class="composer-model-bar" role="dialog" :style="style" :aria-label="t('composer.modelPresetsTitle')" :aria-busy="loading">
    <div class="composer-model-heading">
      <NTooltip>
        <template #trigger><button type="button" class="composer-fast-toggle" :class="{ active: fast && supportsFast }" :disabled="!supportsFast" :aria-label="t('composer.fastMode')" :aria-pressed="fast && supportsFast" @click="emit('fast')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/></svg></button></template>
        {{ supportsFast ? `${t('composer.fastModeHint')} ${t('composer.fastModeCostHint')}` : t('composer.fastUnavailable') }}
      </NTooltip>
      <div class="composer-model-selector" :title="selectionText"><strong class="composer-step-label">{{ label }}</strong><span class="composer-model-name">{{ preview?.modelId }}</span><span class="composer-effort-name">{{ effortLabel(preview?.reasoningLevel) }}</span></div>
      <button type="button" class="composer-reset" :disabled="!presets.some(preset => preset.id === defaultPresetId)" :aria-label="t('composer.reset')" :title="t('composer.reset')" @click="emit('reset')">↺</button>
      <button type="button" class="composer-manage" :aria-label="t('composer.manage')" :title="t('composer.manage')" @click="emit('manage')">⋯</button>
    </div>
    <p v-if="loading" class="preset-notice" role="status">{{ t('composer.loadingPresets') }}</p>
    <div v-else-if="loadFailed" class="preset-notice" role="alert">{{ t('composer.loadFailed') }} <button type="button" @click="emit('retry')">{{ t('common.retry') }}</button></div>
    <div v-else-if="!presets.length" class="preset-notice" data-testid="preset-empty">{{ t('composer.noPresets') }} <button type="button" class="preset-configure" @click="emit('manage')">{{ t('composer.manage') }}</button></div>
    <div v-if="presets.length" class="composer-step-track" :class="{ 'is-custom': index < 0 }">
      <input class="composer-step-slider" type="range" min="0" :max="Math.max(presets.length - 1, 0)" step="1" :value="Math.max(index, 0)" :disabled="presets.length < 2" :aria-label="t('composer.modelPresetsTitle')" :aria-valuetext="selectionText" @input="selectFromInput" />
      <div class="composer-step-dots"><button v-for="(preset, i) in presets" :key="preset.id" type="button" class="composer-step-dot" :style="{ left: `${presets.length < 2 ? 0 : i / (presets.length - 1) * 100}%` }" :class="{ selected: i === index, invalid: !!issues[preset.id] }" :disabled="!!issues[preset.id]" :title="title(preset)" :aria-label="title(preset)" :aria-pressed="i === index" @click="emit('select', i)"><span class="preset-dot"/><span class="preset-position-label">{{ preset.label }}</span></button></div>
    </div>
    <span class="composer-preview-caption">{{ t('composer.previewHint') }}</span>
    <span v-if="isStreaming" class="composer-next-message">{{ t('composer.nextMessage') }}</span>
  </div>
</template>
<style scoped lang="scss">
@use '@/styles/variables' as *;
.composer-model-bar { box-sizing: border-box; width: min(300px, calc(100vw - 32px)); padding: 10px; border-radius: 14px; background: $bg-secondary; box-shadow: 0 8px 28px rgba(0,0,0,.2); border: 1px solid rgba(var(--text-muted-rgb),.2); }
.composer-model-heading { display: flex; align-items: center; gap: 6px; }
button { font: inherit; cursor: pointer; border: 0; color: $text-secondary; background: transparent; border-radius: 8px; &:disabled { opacity: .4; cursor: not-allowed; } &:focus-visible { outline: 2px solid $accent-primary; outline-offset: 2px; } }
.composer-fast-toggle, .composer-reset, .composer-manage { flex: 0 0 24px; height: 28px; display: grid; place-items: center; }
.composer-fast-toggle.active { color: #f9c33c; background: rgba(249,195,60,.12); }
.composer-model-selector { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; padding: 4px 6px; border-radius: 8px; background: rgba(var(--text-muted-rgb),.12); }
.composer-step-label { font-size: 11px; color: $accent-primary; }
.composer-model-name, .composer-effort-name { font-size: 11px; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
.composer-step-track { position: relative; margin-top: 8px; height: 51px; }
.composer-step-slider { position: absolute; inset: 0 0 auto; width: 100%; height: 24px; margin: 0; appearance: none; background: transparent; cursor: pointer;
  &::-webkit-slider-runnable-track { height: 24px; border-radius: 999px; background: linear-gradient(to right, $accent-primary var(--preset-progress), rgba(var(--text-muted-rgb),.25) var(--preset-progress)); }
  &::-webkit-slider-thumb { appearance: none; width: 24px; height: 24px; border: 0; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.18); }
  &::-moz-range-track { height: 24px; border-radius: 999px; background: rgba(var(--text-muted-rgb),.25); }
  &::-moz-range-progress { height: 24px; border-radius: 999px; background: $accent-primary; }
  &::-moz-range-thumb { width: 24px; height: 24px; border: 0; border-radius: 50%; background: #fff; }
  &:focus-visible { outline: 2px solid $accent-primary; outline-offset: 2px; border-radius: 999px; }
}
.is-custom .composer-step-slider { opacity: .35; }
.composer-step-dots { position: absolute; inset: 25px 12px 0; pointer-events: none; }
.composer-step-dot { position: absolute; top: 0; transform: translateX(-50%); pointer-events: auto; padding: 0; min-width: 0; max-width: min(70px, calc(100% / var(--preset-count))); display: flex; flex-direction: column; align-items: center; gap: 3px; .preset-dot { width: 4px; height: 4px; border-radius: 50%; background: $text-muted; } &.selected .preset-dot { background: $accent-primary; } &.invalid .preset-dot { background: #ef4444; } }
// Endpoint names stay inside the panel while dot centres retain exact range positions.
.composer-step-dot:first-child .preset-position-label { transform: translateX(max(0px, calc(50% - 12px))); }
.composer-step-dot:last-child .preset-position-label { transform: translateX(min(0px, calc(12px - 50%))); }
.preset-position-label { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; }
.composer-preview-caption, .composer-next-message { display: block; font-size: 10px; color: $text-muted; text-align: center; margin-top: 5px; }
.preset-notice { color: $text-muted; font-size: 12px; margin: 8px 0; line-height: 1.5; button { color: $accent-primary; } }
</style>
