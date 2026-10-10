<script setup lang="ts">
import { toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import ModelPresetBar from './ModelPresetBar.vue'
import { useModelPresetPreview } from '@/composables/useModelPresetPreview'
const props = withDefaults(defineProps<{ modelDisabled?: boolean }>(), { modelDisabled: false })
const emit = defineEmits<{ manage: [] }>()
const { t } = useI18n()
const message = useMessage()
const state = useModelPresetPreview(toRef(props, 'modelDisabled'), result => message.error(t(
  result === 'fast-failed' ? 'composer.fastUnavailable' : result === 'stale' ? 'composer.presetChanged' : 'composer.switchFailed',
)))
const { anchor, open, busy, committing, presets, defaultPresetId, preview, previewFast, issues, supportsFast, loading, loadFailed, isStreaming } = state
async function manage() { await state.closePanel(); emit('manage') }
</script>
<template>
  <div ref="anchor" class="composer-control" @mouseenter="state.openPanel" @mouseleave="state.leave" @focusout="event => { if (!anchor?.contains(event.relatedTarget as Node)) state.leave() }" @mousedown.stop>
    <button type="button" class="composer-launcher" :disabled="modelDisabled || busy" :aria-label="t('composer.modelPresetsTitle')" :title="t('composer.modelPresetsTitle')" :aria-expanded="open" :aria-busy="committing" aria-haspopup="dialog" @click="state.clickLauncher" @mouseenter="state.openPanel" @focus="state.openPanel">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="8" cy="18" r="2" fill="currentColor"/></svg>
    </button>
    <div v-if="open" class="composer-panel-wrap" @mouseenter="state.clearCloseTimer">
      <ModelPresetBar :presets="presets" :preview="preview" :default-preset-id="defaultPresetId" :fast="previewFast" :supports-fast="supportsFast" :issues="issues" :loading="loading" :load-failed="loadFailed" :is-streaming="isStreaming"
        @select="state.select" @fast="state.toggleFast" @reset="state.reset" @manage="manage" @retry="state.retry" />
    </div>
  </div>
</template>
<style scoped lang="scss">
@use '@/styles/variables' as *;
.composer-control { position: relative; display: inline-flex; align-items: center; }
.composer-panel-wrap { position: absolute; bottom: 100%; right: 0; padding-bottom: 8px; z-index: 50; }
.composer-launcher { font: inherit; border: 0; background: transparent; border-radius: 8px; width: 28px; height: 28px; display: grid; place-items: center; color: $text-secondary; cursor: pointer;
  &:hover, &[aria-expanded="true"] { background: rgba(var(--text-muted-rgb),.12); color: $text-primary; }
  &:disabled { opacity: .4; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid $accent-primary; outline-offset: 2px; }
}
</style>
