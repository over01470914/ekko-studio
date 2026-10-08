<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NInput, NInputNumber, NSelect } from 'naive-ui'
import type { Category, DeploymentNode, ServiceEntry } from './api'
import * as api from './api'
import { useServiceCenterTranslation } from './translation'
const props = defineProps<{ revision: number; categories: Category[]; nodes: DeploymentNode[]; services: ServiceEntry[] }>()
const emit = defineEmits<{ updated: [] }>()
const t = useServiceCenterTranslation()
const tab = ref<'categories' | 'nodes'>('categories')
const draft = ref<{ id: string; name: string; description: string; sortOrder: number }>({ id: '', name: '', description: '', sortOrder: 0 })
const removing = ref<string | null>(null)
const editingId = ref<string | null>(null)
const target = ref<string | null | undefined>(undefined)
const busy = ref(false)
const error = ref('')
const items = computed(() => tab.value === 'categories' ? props.categories : props.nodes)
const sorted = computed(() => [...items.value].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)))
const targets = computed(() => [{ label: tab.value === 'categories' ? t('serviceCenter.uncategorized') : t('serviceCenter.unknownLocation'), value: '__none' }, ...items.value.filter(item => item.id !== removing.value).map(item => ({ label: item.name, value: item.id }))])
const referenced = computed(() => props.services.filter(service => tab.value === 'categories' ? service.categoryId === removing.value : service.nodeId === removing.value).length)
function choose(item?: Category | DeploymentNode) {
  editingId.value = item?.id || null
  draft.value = item ? { ...item, description: 'description' in item ? item.description : '' } : { id: '', name: '', description: '', sortOrder: items.value.length }
  error.value = ''
}
async function save() {
  busy.value = true; error.value = ''
  try {
    if (tab.value === 'categories') await api.saveCategory(props.revision, { id: draft.value.id, name: draft.value.name, sortOrder: draft.value.sortOrder })
    else await api.saveNode(props.revision, draft.value)
    emit('updated'); choose()
  } catch (failure) { error.value = (failure as Error).message }
  finally { busy.value = false }
}
async function remove() {
  if (!removing.value || target.value === undefined || !window.confirm(t('serviceCenter.deleteGroupConfirm'))) return
  busy.value = true; error.value = ''
  try {
    if (tab.value === 'categories') await api.deleteCategory(props.revision, removing.value, target.value)
    else await api.deleteNode(props.revision, removing.value, target.value)
    removing.value = null; target.value = undefined; emit('updated')
  } catch (failure) { error.value = (failure as Error).message }
  finally { busy.value = false }
}
function startRemove(id: string) { removing.value = id; target.value = undefined }
</script>
<template>
  <div class="sc-manager">
    <div class="sc-manager__tabs"><NButton :type="tab === 'categories' ? 'primary' : 'default'" @click="tab = 'categories'; choose()">{{ t('serviceCenter.categories') }}</NButton><NButton :type="tab === 'nodes' ? 'primary' : 'default'" @click="tab = 'nodes'; choose()">{{ t('serviceCenter.deployments') }}</NButton></div>
    <p v-if="error" role="alert" class="sc-manager__error">{{ error }}</p>
    <div v-for="item in sorted" :key="item.id" class="sc-manager__row"><div><strong>{{ item.name }}</strong><small>{{ item.id }} · {{ t('serviceCenter.sortOrder') }} {{ item.sortOrder }}</small><p v-if="'description' in item">{{ item.description }}</p></div><div><NButton :disabled="busy" @click="choose(item)">{{ t('serviceCenter.edit') }}</NButton><NButton :disabled="busy" @click="startRemove(item.id)">{{ t('serviceCenter.delete') }}</NButton></div></div>
    <div v-if="removing" class="sc-manager__delete"><p>{{ t('serviceCenter.reassignHint', { count: referenced }) }}</p><NSelect :value="target === undefined ? null : target || '__none'" :options="targets" :placeholder="t('serviceCenter.chooseTarget')" :aria-label="t('serviceCenter.chooseTarget')" @update:value="value => target = value === '__none' ? null : value" /><NButton type="error" :disabled="target === undefined || busy" @click="remove">{{ t('serviceCenter.confirmDelete') }}</NButton><NButton @click="removing = null">{{ t('serviceCenter.cancel') }}</NButton></div>
    <form class="sc-manager__form" @submit.prevent="save"><h3>{{ editingId ? t('serviceCenter.edit') : t('serviceCenter.addGroup') }}</h3><label>{{ t('serviceCenter.id') }}<NInput v-model:value="draft.id" :disabled="!!editingId" /></label><label>{{ t('serviceCenter.name') }}<NInput v-model:value="draft.name" /></label><label v-if="tab === 'nodes'">{{ t('serviceCenter.description') }}<NInput v-model:value="draft.description" /></label><label>{{ t('serviceCenter.sortOrder') }}<NInputNumber v-model:value="draft.sortOrder" :min="0" :max="1000000" /></label><div><NButton attr-type="submit" type="primary" :loading="busy">{{ t('serviceCenter.save') }}</NButton><NButton @click="choose()">{{ t('serviceCenter.cancel') }}</NButton></div></form>
  </div>
</template>
<style scoped lang="scss">
@use '@/styles/variables' as *;
.sc-manager { min-width: 0; }.sc-manager__tabs { display: flex; gap: 8px; margin-bottom: 15px; }.sc-manager__row { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 1px solid $border-color; padding: 12px 0; flex-wrap: wrap; }.sc-manager__row > div:last-child { display: flex; gap: 6px; }.sc-manager__row small { display: block; color: $text-secondary; }.sc-manager__row p { margin: 3px 0; color: $text-secondary; }.sc-manager__form, .sc-manager__delete { display: grid; gap: 12px; padding: 15px 0; }.sc-manager__form label { display: grid; gap: 5px; }.sc-manager__form > div, .sc-manager__delete { display: flex; flex-wrap: wrap; gap: 8px; }.sc-manager__delete .n-select { min-width: 190px; flex: 1; }.sc-manager__error { color: #c76c66; }.sc-manager__form :deep(button), .sc-manager__delete :deep(button) { min-height: 44px; }
</style>
