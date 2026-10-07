<script setup lang="ts">
import { computed, onMounted, provide, ref } from 'vue'
import { NButton, NInput, NModal, NSelect, NTag, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useServiceCenterStore } from './store'
import * as api from './api'
import type { ImportPreview, Manifest, ServiceEntry } from './api'
import ServiceCard from './ServiceCard.vue'
import ServiceEditor from './ServiceEditor.vue'
import { serviceCenterMessages } from './messages'
import { serviceCenterTranslationKey } from './translation'

const { t } = useI18n({ useScope: 'local', inheritLocale: true, fallbackLocale: 'en',
  messages: Object.fromEntries(Object.entries(serviceCenterMessages).map(([locale, messages]) => [locale, { serviceCenter: messages }])) })
provide(serviceCenterTranslationKey, (key, named) => named ? t(key, named) : t(key))
const message = useMessage()
const store = useServiceCenterStore()
const search = ref('')
const category = ref('all')
const onlyFavorites = ref(false)
const editing = ref(false)
const editingService = ref<ServiceEntry | null>(null)
const saving = ref(false)
const actionError = ref('')
const importing = ref(false)
const importName = ref('')
const incoming = ref<Manifest | null>(null)
const preview = ref<ImportPreview | null>(null)
const choices = ref<Record<string, 'keep' | 'overwrite' | null>>({})
const permissionsOpen = ref(false)
const permissionUsers = ref<Array<{ id: number; username: string; role: string; status: string }>>([])
const editorIds = ref<number[]>([])
const permissionBusy = ref(false)
const importBusy = ref(false)
const modalStyle = { width: 'min(760px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)',
  boxShadow: '0 18px 60px rgba(0, 0, 0, .28)' }

const rights = computed(() => store.catalog.capabilities)
const categories = computed(() => [
  { label: t('serviceCenter.allCategories'), value: 'all' },
  ...[...new Set(store.catalog.services.map(service => service.category))].sort().map(value => ({ label: value, value })),
])
const visible = computed(() => store.catalog.services.filter(service => {
  const query = search.value.trim().toLocaleLowerCase()
  return (category.value === 'all' || category.value === service.category) &&
    (!onlyFavorites.value || store.catalog.favorites.includes(service.id)) &&
    (!query || [service.name, service.description, service.category, ...service.tags].some(value => value.toLocaleLowerCase().includes(query)))
}).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)))
const allSelected = computed(() => preview.value?.conflicts.every(conflict => choices.value[conflict.id]) ?? false)
const activeAdmins = computed(() => permissionUsers.value.filter(user => user.role === 'admin' && user.status === 'active'))

function fail(error: unknown) {
  actionError.value = (error as Error).message || t('serviceCenter.failed')
  message.error(actionError.value)
}
function openEditor(service: ServiceEntry | null = null) {
  actionError.value = ''
  editingService.value = service
  editing.value = true
}
async function save(service: ServiceEntry) {
  saving.value = true
  actionError.value = ''
  try {
    await store.save(service)
    editing.value = false
    message.success(t('serviceCenter.saved'))
  } catch (error) { fail(error) }
  finally { saving.value = false }
}
async function remove(service: ServiceEntry) {
  if (!window.confirm(t('serviceCenter.deleteConfirm', { name: service.name }))) return
  try { await store.remove(service.id); message.success(t('serviceCenter.deleted')) } catch (error) { fail(error) }
}
async function favorite(service: ServiceEntry) {
  try { await store.favorite(service.id) } catch (error) { fail(error) }
}
async function check(service: ServiceEntry) {
  try { await store.check(service.id) } catch (error) { fail(error) }
}
async function approve(service: ServiceEntry) {
  const approved = store.catalog.health[service.id]?.state === 'unapproved'
  if (approved && !window.confirm(t('serviceCenter.approveConfirm', { name: service.name }))) return
  try { await api.approveHealth(service.id, approved); await store.refresh(); message.success(t(approved ? 'serviceCenter.approved' : 'serviceCenter.revoked')) }
  catch (error) { fail(error) }
}
async function exportData() {
  try {
    const manifest = await api.exportManifest()
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'service-center-manifest-v1.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  } catch (error) { fail(error) }
}
async function selectImport(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  preview.value = null
  incoming.value = null
  importName.value = ''
  if (!file) return
  if (file.size > 256_000) { fail(new Error(t('serviceCenter.fileTooLarge'))); return }
  try {
    incoming.value = JSON.parse(await file.text()) as Manifest
    importName.value = file.name
  } catch { fail(new Error(t('serviceCenter.invalidJson'))) }
}
async function previewData() {
  if (!incoming.value) return
  actionError.value = ''
  try {
    preview.value = await api.previewImport(incoming.value)
    choices.value = Object.fromEntries(preview.value.conflicts.map(conflict => [conflict.id, null]))
  } catch (error) { preview.value = null; fail(error) }
}
async function confirmData() {
  if (!incoming.value || !preview.value || !allSelected.value || importBusy.value) return
  importBusy.value = true
  try {
    await api.confirmImport(preview.value.revision, incoming.value, choices.value as Record<string, 'keep' | 'overwrite'>)
    await store.refresh()
    importing.value = false
    preview.value = null
    incoming.value = null
    message.success(t('serviceCenter.imported'))
  } catch (error) { fail(error) }
  finally { importBusy.value = false }
}
async function openPermissions() {
  try {
    const [accounts, grants] = await Promise.all([api.fetchManagedUsers(), api.fetchEditors()])
    permissionUsers.value = accounts.users
    editorIds.value = grants.editorIds
    permissionsOpen.value = true
  } catch (error) { fail(error) }
}
async function changePermission(id: number) {
  permissionBusy.value = true
  try {
    editorIds.value = (await api.setEditor(id, !editorIds.value.includes(id))).editorIds
    message.success(t('serviceCenter.permissionSaved'))
  } catch (error) { fail(error) }
  finally { permissionBusy.value = false }
}
onMounted(() => { void store.refresh() })
</script>

<template>
  <div class="service-center">
    <header class="service-center__header">
      <div><p class="service-center__eyebrow">STUDIO / DIRECTORY</p><h1>{{ t('serviceCenter.title') }}</h1><p>{{ t('serviceCenter.subtitle') }}</p></div>
      <div class="service-center__toolbar">
        <NButton @click="store.refresh()">{{ t('serviceCenter.refresh') }}</NButton>
        <NButton @click="exportData">{{ t('serviceCenter.export') }}</NButton>
        <NButton v-if="rights.canManageEditors" @click="openPermissions">{{ t('serviceCenter.permissions') }}</NButton>
        <NButton v-if="rights.canManageServices" @click="importing = true">{{ t('serviceCenter.import') }}</NButton>
        <NButton v-if="rights.canManageServices" type="primary" @click="openEditor()">{{ t('serviceCenter.add') }}</NButton>
      </div>
    </header>
    <p class="service-center__note">{{ t('serviceCenter.reachability') }}</p>
    <div class="service-center__filters">
      <NInput v-model:value="search" clearable :placeholder="t('serviceCenter.search')" :aria-label="t('serviceCenter.search')" />
      <NSelect v-model:value="category" :options="categories" :aria-label="t('serviceCenter.categoryFilter')" />
      <NButton :type="onlyFavorites ? 'primary' : 'default'" :secondary="onlyFavorites" @click="onlyFavorites = !onlyFavorites">{{ t('serviceCenter.favorites') }}</NButton>
      <NTag :bordered="false">{{ visible.length }}</NTag>
    </div>
    <div v-if="actionError || store.error" class="service-center__error" role="alert">{{ actionError || store.error }} <NButton text @click="store.refresh()">{{ t('serviceCenter.reload') }}</NButton></div>
    <p v-if="store.loading" class="service-center__empty">{{ t('serviceCenter.loading') }}</p>
    <p v-else-if="!visible.length" class="service-center__empty">{{ store.catalog.services.length ? t('serviceCenter.noMatches') : t('serviceCenter.empty') }}</p>
    <div v-else class="service-center__grid">
      <ServiceCard v-for="service in visible" :key="service.id" :service="service" :health="store.catalog.health[service.id]" :favorite="store.catalog.favorites.includes(service.id)" :can-edit="rights.canManageServices" @favorite="favorite(service)" @check="check(service)" @edit="openEditor(service)" @approve="approve(service)" @remove="remove(service)" />
    </div>

    <NModal v-model:show="editing" preset="card" :title="t(editingService ? 'serviceCenter.editTitle' : 'serviceCenter.addTitle')" :style="modalStyle" class="service-center__modal">
      <ServiceEditor v-if="editing" :key="editingService?.id || 'new'" :service="editingService" :busy="saving" @save="save" @cancel="editing = false" />
      <p v-if="actionError" role="alert" class="service-center__error">{{ actionError }}</p>
    </NModal>
    <NModal v-model:show="importing" preset="card" :title="t('serviceCenter.importTitle')" :style="modalStyle" class="service-center__modal">
      <p>{{ t('serviceCenter.importHint') }}</p>
      <input type="file" accept=".json,application/json" :aria-label="t('serviceCenter.chooseFile')" @change="selectImport" />
      <p v-if="importName">{{ importName }}</p>
      <NButton :disabled="!incoming" @click="previewData">{{ t('serviceCenter.preview') }}</NButton>
      <div v-if="preview" class="service-center__import-preview">
        <p>{{ t('serviceCenter.importSummary', { count: preview.count, fresh: preview.newIds.length, conflicts: preview.conflicts.length }) }}</p>
        <div v-for="conflict in preview.conflicts" :key="conflict.id" class="service-center__conflict">
          <strong>{{ conflict.id }}</strong><span>{{ conflict.current.name }} → {{ conflict.incoming.name }}</span>
          <NSelect v-model:value="choices[conflict.id]" :aria-label="t('serviceCenter.conflictChoice', { id: conflict.id })" :options="[{ label: t('serviceCenter.keep'), value: 'keep' }, { label: t('serviceCenter.overwrite'), value: 'overwrite' }]" />
        </div>
        <NButton type="primary" :disabled="!allSelected" :loading="importBusy" @click="confirmData">{{ t('serviceCenter.confirmImport') }}</NButton>
      </div>
      <p v-if="actionError" role="alert" class="service-center__error">{{ actionError }}</p>
    </NModal>
    <NModal v-model:show="permissionsOpen" preset="card" :title="t('serviceCenter.permissionsTitle')" :style="modalStyle" class="service-center__modal">
      <p>{{ t('serviceCenter.permissionsHint') }}</p>
      <div v-for="user in activeAdmins" :key="user.id" class="service-center__permission"><span>{{ user.username }}</span><NButton :disabled="permissionBusy" size="small" @click="changePermission(user.id)">{{ t(editorIds.includes(user.id) ? 'serviceCenter.revoke' : 'serviceCenter.grant') }}</NButton></div>
      <p v-if="!activeAdmins.length">{{ t('serviceCenter.noAdmins') }}</p>
    </NModal>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;
.service-center { width: 100%; max-width: 1440px; margin: 0 auto; padding: 28px clamp(16px, 3vw, 48px) 60px; color: $text-primary; overflow-y: auto; }
.service-center__header { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; flex-wrap: wrap; }
.service-center__header h1 { font-size: clamp(24px, 3vw, 34px); margin: 4px 0; letter-spacing: -.025em; }
.service-center__header p { margin: 4px 0; color: $text-secondary; }
.service-center__eyebrow { font-size: 10px; font-weight: 700; letter-spacing: .22em; color: $accent-primary !important; }
.service-center__toolbar { display: flex; flex-wrap: wrap; gap: 8px; }
.service-center__note { color: $text-muted; margin: 18px 0; font-size: 12px; }
.service-center__filters { display: grid; grid-template-columns: minmax(160px, 2fr) minmax(130px, 1fr) auto auto; align-items: center; gap: 10px; margin: 22px 0; }
.service-center__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(255px, 1fr)); gap: 14px; }
.service-center__empty { padding: 60px 16px; text-align: center; color: $text-secondary; border: 1px dashed $border-color; border-radius: $radius-md; }
.service-center__error { padding: 10px; color: #d9746a; border: 1px solid #d9746a; border-radius: $radius-sm; margin: 12px 0; overflow-wrap: anywhere; }
.service-center__import-preview { margin: 18px 0; }
.service-center__conflict, .service-center__permission { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding: 10px 0; border-bottom: 1px solid $border-color; }
.service-center__conflict .n-select { max-width: 200px; }
@media (max-width: 640px) { .service-center { padding-top: 68px; } .service-center__filters { grid-template-columns: 1fr 1fr; } .service-center__filters .n-input { grid-column: 1 / -1; } .service-center__header { align-items: flex-start; } }
</style>
