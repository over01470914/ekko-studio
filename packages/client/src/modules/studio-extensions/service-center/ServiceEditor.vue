<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NFormItem, NInput, NInputNumber, NSelect, NSwitch } from 'naive-ui'
import type { ServiceEntry } from './api'
import { useServiceCenterTranslation } from './translation'
const props = defineProps<{ service: ServiceEntry | null; busy: boolean }>()
const emit = defineEmits<{ save: [service: ServiceEntry]; cancel: [] }>()
const t = useServiceCenterTranslation()
const draft = ref<ServiceEntry>(props.service ? { ...props.service, tags: [...props.service.tags] } : {
  id: '', name: '', description: '', url: '', icon: 'globe', category: '', tags: [], network: 'public', enabled: true, sortOrder: 0,
})
const tagText = ref(draft.value.tags.join(', '))
const networks = computed(() => (['tailscale', 'lan', 'public', 'local'] as const).map(value => ({ label: t(`serviceCenter.network.${value}`), value })))
const icons = computed(() => (['globe', 'server', 'cloud', 'tool', 'database', 'monitor', 'folder', 'shield']).map(value => ({ label: t(`serviceCenter.icon.${value}`), value })))
function submit() {
  const service = { ...draft.value }
  service.tags = tagText.value.split(',').map(tag => tag.trim()).filter(Boolean)
  if (!service.healthUrl) { delete service.healthUrl; service.healthCheckEnabled = false }
  emit('save', service)
}
</script>

<template>
  <form class="service-editor" @submit.prevent="submit">
    <div class="service-editor__grid">
      <NFormItem :label="t('serviceCenter.id')"><NInput v-model:value="draft.id" :input-props="{ 'aria-label': t('serviceCenter.id') }" :disabled="!!props.service" placeholder="my-service" /></NFormItem>
      <NFormItem :label="t('serviceCenter.name')"><NInput v-model:value="draft.name" :input-props="{ 'aria-label': t('serviceCenter.name') }" /></NFormItem>
      <NFormItem class="service-editor__wide" :label="t('serviceCenter.description')"><NInput v-model:value="draft.description" type="textarea" :rows="2" /></NFormItem>
      <NFormItem class="service-editor__wide" :label="t('serviceCenter.url')"><NInput v-model:value="draft.url" :input-props="{ 'aria-label': t('serviceCenter.url') }" placeholder="https://example.org/" /></NFormItem>
      <NFormItem :label="t('serviceCenter.iconLabel')"><NSelect v-model:value="draft.icon" :options="icons" /></NFormItem>
      <NFormItem :label="t('serviceCenter.category')"><NInput v-model:value="draft.category" :input-props="{ 'aria-label': t('serviceCenter.category') }" /></NFormItem>
      <NFormItem :label="t('serviceCenter.networkLabel')"><NSelect v-model:value="draft.network" :options="networks" /></NFormItem>
      <NFormItem :label="t('serviceCenter.sortOrder')"><NInputNumber v-model:value="draft.sortOrder" :min="0" :max="1000000" /></NFormItem>
      <NFormItem class="service-editor__wide" :label="t('serviceCenter.tags')"><NInput v-model:value="tagText" :placeholder="t('serviceCenter.tagsHint')" /></NFormItem>
      <NFormItem class="service-editor__wide" :label="t('serviceCenter.healthUrl')"><NInput v-model:value="draft.healthUrl" placeholder="https://example.org/health" /></NFormItem>
      <NFormItem :label="t('serviceCenter.enabled')"><NSwitch v-model:value="draft.enabled" /></NFormItem>
      <NFormItem :label="t('serviceCenter.healthEnabled')"><NSwitch v-model:value="draft.healthCheckEnabled" :disabled="!draft.healthUrl" /></NFormItem>
    </div>
    <p class="service-editor__hint">{{ t('serviceCenter.approvalHint') }}</p>
    <div class="service-editor__actions"><NButton @click="emit('cancel')">{{ t('serviceCenter.cancel') }}</NButton><NButton type="primary" attr-type="submit" :loading="props.busy">{{ t('serviceCenter.save') }}</NButton></div>
  </form>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;
.service-editor__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 16px; }
.service-editor__wide { grid-column: 1 / -1; }
.service-editor__hint { color: $text-secondary; font-size: 12px; }
.service-editor__actions { position: sticky; bottom: -20px; z-index: 1; display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; padding: 12px 0; background: $bg-card; border-top: 1px solid $border-color; }
@media (max-width: 640px) { .service-editor__grid { grid-template-columns: 1fr; } }
</style>
