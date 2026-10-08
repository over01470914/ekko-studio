<script setup lang="ts">
import { computed, onMounted, provide, ref } from 'vue'
import { NButton, NInput, NModal, NSelect, NTag, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useServiceCenterStore } from './store'
import * as api from './api'
import type { ImportPreview, Manifest, ServiceEntry } from './api'
import ServiceCard from './ServiceCard.vue'
import ServiceEditor from './ServiceEditor.vue'
import InfoPanel from './InfoPanel.vue'
import OrganizationManager from './OrganizationManager.vue'
import type { Network, LegacyManifest } from './api'
import { serviceCenterMessages } from './messages'
import { serviceCenterTranslationKey } from './translation'

const { t } = useI18n({ useScope: 'local', inheritLocale: true, fallbackLocale: 'en',
  messages: Object.fromEntries(Object.entries(serviceCenterMessages).map(([locale, messages]) => [locale, { serviceCenter: messages }])) })
provide(serviceCenterTranslationKey, (key, named) => named ? t(key, named) : t(key))
const message = useMessage()
const store = useServiceCenterStore()
const search = ref('')
const category = ref('all')
const node = ref('all')
const network = ref('all')
const selectedEndpoints = ref<Record<string, string>>({})
const panelOpen = ref(false)
const panelId = ref<string | null>(null)
const panelService = computed(() => store.catalog.services.find(item => item.id === panelId.value) || null)
const panelEndpoint = computed(() => panelService.value?.endpoints.find(item => item.id === (selectedEndpoints.value[panelService.value!.id] || panelService.value!.defaultEndpointId)))
const managerOpen = ref(false)
const onlyFavorites = ref(false)
const editing = ref(false)
const editingService = ref<ServiceEntry | null>(null)
const saving = ref(false)
const actionError = ref('')
const importing = ref(false)
const importName = ref('')
const incoming = ref<Manifest | LegacyManifest | null>(null)
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
  ...[...store.catalog.categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map(item => ({ label: item.name, value: item.id })),
  ...(store.catalog.services.some(service => service.categoryId === null) ? [{ label: t('serviceCenter.uncategorized'), value: '__none' }] : []),
])
const nodes = computed(() => [{ label: t('serviceCenter.allDeployments'), value: 'all' }, ...[...store.catalog.nodes].sort((a, b) => a.sortOrder - b.sortOrder).map(item => ({ label: item.name, value: item.id })), { label: t('serviceCenter.unknownLocation'), value: '__none' }])
const networks = computed(() => [{ label: t('serviceCenter.allNetworks'), value: 'all' }, ...(['local', 'lan', 'tailscale', 'public'] as Network[]).map(value => ({ label: t(`serviceCenter.network.${value}`), value }))])
const visible = computed(() => store.catalog.services.filter(service => {
  const query = search.value.trim().toLocaleLowerCase()
  const entry = service.endpoints.find(item => item.id === (selectedEndpoints.value[service.id] || service.defaultEndpointId))
  const categoryName = store.catalog.categories.find(item => item.id === service.categoryId)?.name || ''
  const nodeName = store.catalog.nodes.find(item => item.id === service.nodeId)?.name || ''
  return (category.value === 'all' || (category.value === '__none' ? service.categoryId === null : service.categoryId === category.value)) &&
    (node.value === 'all' || (node.value === '__none' ? service.nodeId === null : service.nodeId === node.value)) &&
    (network.value === 'all' || entry?.network === network.value) &&
    (!onlyFavorites.value || store.catalog.favorites.includes(service.id)) &&
    (!query || [service.name, service.description, categoryName, nodeName, ...service.endpoints.map(item => item.label), ...service.tags].some(value => value.toLocaleLowerCase().includes(query)))
}).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)))
const allSelected = computed(() => preview.value?.conflicts.every(conflict => choices.value[conflict.key]) ?? false)
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
function openInfo(service: ServiceEntry | null = null) { panelId.value = service?.id || null; panelOpen.value = true }
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
  try { await store.remove(service.id); panelOpen.value = false; message.success(t('serviceCenter.deleted')) } catch (error) { fail(error) }
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
    link.download = 'service-center-manifest-v2.json'
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
    incoming.value = JSON.parse(await file.text()) as Manifest | LegacyManifest
    importName.value = file.name
  } catch { fail(new Error(t('serviceCenter.invalidJson'))) }
}
async function previewData() {
  if (!incoming.value) return
  actionError.value = ''
  try {
    preview.value = await api.previewImport(incoming.value)
    choices.value = Object.fromEntries(preview.value.conflicts.map(conflict => [conflict.key, null]))
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
    <div class="service-center__note"><span>{{ t('serviceCenter.reachability') }}</span><NButton secondary class="service-center__legend" @click="openInfo()">{{ t('serviceCenter.legend') }}</NButton></div>
    <div class="service-center__category-row">
      <nav class="service-center__categories" :aria-label="t('serviceCenter.categoryFilter')"><button v-for="option in categories" :key="option.value" type="button" :aria-current="category === option.value ? 'page' : undefined" @click="category = option.value">{{ option.label }}</button></nav>
      <NButton v-if="rights.canManageServices" text class="service-center__manage" @click="managerOpen = true">{{ t('serviceCenter.manageOrganization') }}</NButton>
    </div>
    <div class="service-center__filters">
      <NInput v-model:value="search" clearable :placeholder="t('serviceCenter.search')" :aria-label="t('serviceCenter.search')" />
      <NSelect v-model:value="node" :options="nodes" :aria-label="t('serviceCenter.deployment')" />
      <NSelect v-model:value="network" :options="networks" :aria-label="t('serviceCenter.networkLabel')" />
      <div class="service-center__favorites"><NButton :type="onlyFavorites ? 'primary' : 'default'" :secondary="onlyFavorites" @click="onlyFavorites = !onlyFavorites">{{ t('serviceCenter.favorites') }}</NButton><NTag :bordered="false">{{ visible.length }}</NTag></div>
    </div>
    <div v-if="actionError || store.error" class="service-center__error" role="alert">{{ actionError || store.error }} <NButton text @click="store.refresh()">{{ t('serviceCenter.reload') }}</NButton></div>
    <p v-if="store.loading" class="service-center__empty">{{ t('serviceCenter.loading') }}</p>
    <p v-else-if="!visible.length" class="service-center__empty">{{ store.catalog.services.length ? t('serviceCenter.noMatches') : t('serviceCenter.empty') }}</p>
    <div v-else class="service-center__grid">
      <ServiceCard v-for="service in visible" :key="service.id" :service="service" :health="store.catalog.health[service.id]" :favorite="store.catalog.favorites.includes(service.id)" :node-name="store.catalog.nodes.find(item => item.id === service.nodeId)?.name" :selected-endpoint-id="selectedEndpoints[service.id]" @favorite="favorite(service)" @info="openInfo(service)" @select="id => selectedEndpoints[service.id] = id" />
    </div>

    <InfoPanel :open="panelOpen" :service="panelService" :category="store.catalog.categories.find(item => item.id === panelService?.categoryId)" :node="store.catalog.nodes.find(item => item.id === panelService?.nodeId)" :health="panelService ? store.catalog.health[panelService.id] : undefined" :selected-endpoint-id="panelEndpoint?.id" :can-edit="rights.canManageServices" @close="panelOpen = false" @edit="panelOpen = false; openEditor(panelService)" @remove="panelService && remove(panelService)" @check="panelService && check(panelService)" @approve="panelService && approve(panelService)" />

    <NModal v-model:show="editing" preset="card" :title="t(editingService ? 'serviceCenter.editTitle' : 'serviceCenter.addTitle')" :style="modalStyle" class="service-center__modal">
      <ServiceEditor v-if="editing" :key="editingService?.id || 'new'" :service="editingService" :busy="saving" :categories="store.catalog.categories" :nodes="store.catalog.nodes" @save="save" @cancel="editing = false" />
      <p v-if="actionError" role="alert" class="service-center__error">{{ actionError }}</p>
    </NModal>
    <NModal v-model:show="managerOpen" preset="card" :title="t('serviceCenter.manageOrganization')" :style="modalStyle" class="service-center__modal"><OrganizationManager :revision="store.catalog.revision" :categories="store.catalog.categories" :nodes="store.catalog.nodes" :services="store.catalog.services" @updated="store.refresh()" /></NModal>
    <NModal v-model:show="importing" preset="card" :title="t('serviceCenter.importTitle')" :style="modalStyle" class="service-center__modal">
      <p>{{ t('serviceCenter.importHint') }}</p>
      <input type="file" accept=".json,application/json" :aria-label="t('serviceCenter.chooseFile')" @change="selectImport" />
      <p v-if="importName">{{ importName }}</p>
      <NButton :disabled="!incoming" @click="previewData">{{ t('serviceCenter.preview') }}</NButton>
      <div v-if="preview" class="service-center__import-preview">
        <p>{{ t('serviceCenter.importSummary', { count: preview.count, fresh: preview.newIds.services.length, conflicts: preview.conflicts.length }) }} · v{{ preview.sourceSchemaVersion }} → v2</p>
        <p>{{ t('serviceCenter.importEntities', { categories: preview.newIds.categories.length, nodes: preview.newIds.nodes.length }) }}</p>
        <p v-for="reference in preview.references" :key="reference.id">{{ reference.id }} · {{ reference.categoryId || t('serviceCenter.uncategorized') }} · {{ reference.nodeId || t('serviceCenter.unknownLocation') }}</p>
        <div v-for="conflict in preview.conflicts" :key="conflict.key" class="service-center__conflict">
          <strong>{{ conflict.key }}</strong><span>{{ conflict.current.name }} → {{ conflict.incoming.name }}</span>
          <NSelect v-model:value="choices[conflict.key]" :aria-label="t('serviceCenter.conflictChoice', { id: conflict.key })" :options="[{ label: t('serviceCenter.keep'), value: 'keep' }, { label: t('serviceCenter.overwrite'), value: 'overwrite' }]" />
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
.service-center__note { color: $text-secondary; margin: 18px 0 12px; font-size: 13px; display: flex; align-items: center; justify-content: space-between; gap: 12px 24px; flex-wrap: wrap; }
.service-center__note > span { flex: 1 1 320px; max-width: 68ch; line-height: 1.5; }
.service-center__legend { flex: none; min-height: 44px; color: $text-primary; }
.service-center__category-row { display: flex; align-items: center; gap: 12px; border-bottom: 1px solid $border-color; }
.service-center__categories { display: flex; flex: 1; min-width: 0; gap: 5px; overflow-x: auto; padding: 4px 0 0; }
.service-center__manage { flex: none; min-height: 44px; color: $text-secondary; }
.service-center__manage:hover, .service-center__manage:focus-visible { color: $accent-primary; }
.service-center__categories button { white-space: nowrap; flex: none; min-height: 44px; padding: 0 14px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: $text-secondary; cursor: pointer; }
.service-center__categories button[aria-current='page'] { border-color: $accent-primary; color: $text-primary; font-weight: 600; }
.service-center__categories button:focus-visible { outline: 2px solid $accent-primary; outline-offset: -2px; }
.service-center__filters { display: grid; grid-template-columns: minmax(160px, 2fr) minmax(130px, 1fr) minmax(130px, 1fr) auto; align-items: center; gap: 12px; margin: 14px 0 20px; }
.service-center__favorites { display: flex; align-items: center; gap: 4px; }
.service-center__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(255px, 1fr)); gap: 14px; }
.service-center__empty { padding: 60px 16px; text-align: center; color: $text-secondary; border: 1px dashed $border-color; border-radius: $radius-md; }
.service-center__error { padding: 10px; color: #d9746a; border: 1px solid #d9746a; border-radius: $radius-sm; margin: 12px 0; overflow-wrap: anywhere; }
.service-center__import-preview { margin: 18px 0; }
.service-center__conflict, .service-center__permission { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding: 10px 0; border-bottom: 1px solid $border-color; }
.service-center__conflict .n-select { max-width: 200px; }
@media (max-width: 900px) { .service-center__filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } .service-center__filters .n-input { grid-column: 1 / -1; } }
@media (max-width: 640px) { .service-center { padding-top: 68px; } .service-center__header { align-items: flex-start; } .service-center__toolbar :deep(button) { min-height: 44px; } .service-center__category-row { flex-wrap: wrap; } .service-center__categories { flex-basis: 100%; } .service-center__manage { margin: 0 0 8px; } }
</style>
