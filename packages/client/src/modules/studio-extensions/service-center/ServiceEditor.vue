<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NFormItem, NInput, NInputNumber, NSelect, NSwitch } from 'naive-ui'
import type { Category, DeploymentNode, ServiceEntry } from './api'
import { useServiceCenterTranslation } from './translation'
const props = defineProps<{ service: ServiceEntry | null; busy: boolean; categories: Category[]; nodes: DeploymentNode[] }>()
const emit = defineEmits<{ save: [service: ServiceEntry]; cancel: [] }>()
const t = useServiceCenterTranslation()
const draft = ref<ServiceEntry>(props.service ? { ...props.service, tags: [...props.service.tags], endpoints: props.service.endpoints.map(entry => ({ ...entry })) } : {
  id: '', name: '', description: '', icon: 'globe', categoryId: null, nodeId: null, tags: [], endpoints: [{ id: 'primary', label: 'Primary', url: '', network: 'public', login: 'unknown' }], defaultEndpointId: 'primary', enabled: true, sortOrder: 0,
})
const tagText = ref(draft.value.tags.join(', '))
const validationError = ref('')
const networks = computed(() => (['tailscale', 'lan', 'public', 'local'] as const).map(value => ({ label: t(`serviceCenter.network.${value}`), value })))
const logins = computed(() => (['unknown', 'required', 'none'] as const).map(value => ({ label: t(`serviceCenter.login.${value}`), value })))
const icons = computed(() => (['globe', 'server', 'cloud', 'tool', 'database', 'monitor', 'folder', 'shield']).map(value => ({ label: t(`serviceCenter.icon.${value}`), value })))
const categoryOptions = computed(() => [{ label: t('serviceCenter.uncategorized'), value: '__none' }, ...props.categories.map(item => ({ label: item.name, value: item.id }))])
const nodeOptions = computed(() => [{ label: t('serviceCenter.unknownLocation'), value: '__none' }, ...props.nodes.map(item => ({ label: item.name, value: item.id }))])
function addEndpoint() {
  if (draft.value.endpoints.length >= 8) return
  let n = 1
  while (draft.value.endpoints.some(item => item.id === `entry-${n}`)) n++
  draft.value.endpoints.push({ id: `entry-${n}`, label: '', url: '', network: 'public', login: 'unknown' })
}
function removeEndpoint(id: string) {
  if (draft.value.endpoints.length <= 1 || draft.value.defaultEndpointId === id) return
  draft.value.endpoints = draft.value.endpoints.filter(item => item.id !== id)
}
function moveEndpoint(index: number, offset: number) {
  const to = index + offset
  if (to < 0 || to >= draft.value.endpoints.length) return
  const [entry] = draft.value.endpoints.splice(index, 1)
  draft.value.endpoints.splice(to, 0, entry)
}
function submit() {
  validationError.value = ''
  const service = { ...draft.value, tags: tagText.value.split(',').map(tag => tag.trim()).filter(Boolean), endpoints: draft.value.endpoints.map(item => ({ ...item })) }
  if (!service.endpoints.length || !service.endpoints.some(item => item.id === service.defaultEndpointId) || service.endpoints.some(item => !item.label || !item.url)) {
    validationError.value = t('serviceCenter.invalidEntrances'); return
  }
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
      <NFormItem :label="t('serviceCenter.iconLabel')"><NSelect v-model:value="draft.icon" :options="icons" /></NFormItem>
      <NFormItem :label="t('serviceCenter.category')"><NSelect :value="draft.categoryId || '__none'" :options="categoryOptions" :aria-label="t('serviceCenter.category')" @update:value="value => draft.categoryId = value === '__none' ? null : value" /></NFormItem>
      <NFormItem :label="t('serviceCenter.deployment')"><NSelect :value="draft.nodeId || '__none'" :options="nodeOptions" :aria-label="t('serviceCenter.deployment')" @update:value="value => draft.nodeId = value === '__none' ? null : value" /></NFormItem>
      <NFormItem :label="t('serviceCenter.sortOrder')"><NInputNumber v-model:value="draft.sortOrder" :min="0" :max="1000000" /></NFormItem>
      <NFormItem class="service-editor__wide" :label="t('serviceCenter.tags')"><NInput v-model:value="tagText" :placeholder="t('serviceCenter.tagsHint')" /></NFormItem>
    </div>
    <section class="service-editor__entrances"><header><div><h3>{{ t('serviceCenter.entrances') }}</h3><p>{{ t('serviceCenter.entranceHint') }}</p></div><NButton :disabled="draft.endpoints.length >= 8" @click="addEndpoint">{{ t('serviceCenter.addEntrance') }}</NButton></header>
      <article v-for="(entry, index) in draft.endpoints" :key="entry.id" class="service-editor__entry">
        <div class="service-editor__entry-head"><strong>{{ entry.label || entry.id }}</strong><div><NButton size="small" :disabled="index === 0" :aria-label="t('serviceCenter.moveUp')" @click="moveEndpoint(index, -1)">{{ t('serviceCenter.moveUp') }}</NButton><NButton size="small" :disabled="index === draft.endpoints.length - 1" :aria-label="t('serviceCenter.moveDown')" @click="moveEndpoint(index, 1)">{{ t('serviceCenter.moveDown') }}</NButton><NButton size="small" :disabled="draft.endpoints.length === 1 || draft.defaultEndpointId === entry.id" @click="removeEndpoint(entry.id)">{{ t('serviceCenter.removeEntrance') }}</NButton></div></div>
        <div class="service-editor__grid"><NFormItem :label="t('serviceCenter.entranceId')"><NInput :value="entry.id" disabled /></NFormItem><NFormItem :label="t('serviceCenter.entranceLabel')"><NInput v-model:value="entry.label" /></NFormItem><NFormItem class="service-editor__wide" :label="t('serviceCenter.url')"><NInput v-model:value="entry.url" :input-props="{ 'aria-label': `${t('serviceCenter.url')} ${index + 1}` }" placeholder="https://example.org/" /></NFormItem><NFormItem :label="t('serviceCenter.networkLabel')"><NSelect v-model:value="entry.network" :options="networks" /></NFormItem><NFormItem :label="t('serviceCenter.loginLabel')"><NSelect v-model:value="entry.login" :options="logins" /></NFormItem></div>
        <label class="service-editor__default"><input v-model="draft.defaultEndpointId" type="radio" :value="entry.id" />{{ t('serviceCenter.setDefault') }}</label>
      </article>
    </section>
    <div class="service-editor__grid"><NFormItem class="service-editor__wide" :label="t('serviceCenter.healthUrl')"><NInput v-model:value="draft.healthUrl" placeholder="https://example.org/health" /></NFormItem><NFormItem :label="t('serviceCenter.enabled')"><NSwitch v-model:value="draft.enabled" /></NFormItem><NFormItem :label="t('serviceCenter.healthEnabled')"><NSwitch v-model:value="draft.healthCheckEnabled" :disabled="!draft.healthUrl" /></NFormItem></div>
    <p class="service-editor__hint">{{ t('serviceCenter.approvalHint') }}</p><p v-if="validationError" role="alert" class="service-editor__error">{{ validationError }}</p>
    <div class="service-editor__actions"><NButton @click="emit('cancel')">{{ t('serviceCenter.cancel') }}</NButton><NButton type="primary" attr-type="submit" :loading="props.busy">{{ t('serviceCenter.save') }}</NButton></div>
  </form>
</template>
<style scoped lang="scss">
@use '@/styles/variables' as *;
.service-editor__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 16px; }
.service-editor__wide { grid-column: 1 / -1; }.service-editor__hint, .service-editor__entrances p { color: $text-secondary; font-size: 12px; }.service-editor__error { color: #c76c66; }
.service-editor__entrances { border-top: 1px solid $border-color; padding: 12px 0; }.service-editor__entrances header, .service-editor__entry-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }.service-editor__entrances h3 { margin: 0; font-size: 15px; }
.service-editor__entry { border: 1px solid $border-color; border-radius: $radius-sm; padding: 12px; margin: 10px 0; min-width: 0; }.service-editor__entry-head > div { display: flex; gap: 4px; flex-wrap: wrap; }.service-editor__default { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; cursor: pointer; }.service-editor__default input { accent-color: $accent-primary; }
.service-editor__actions { position: sticky; bottom: -20px; z-index: 1; display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; padding: 12px 0; background: $bg-card; border-top: 1px solid $border-color; }.service-editor__actions :deep(button) { min-height: 44px; }
@media (max-width: 640px) { .service-editor__grid { grid-template-columns: 1fr; }.service-editor__entry { padding: 10px; } }
</style>