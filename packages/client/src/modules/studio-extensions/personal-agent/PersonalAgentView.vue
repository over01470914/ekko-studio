<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NAlert, NButton, NCard, NCheckbox, NFormItem, NInput, NModal, NSelect, NSpace, NTag } from 'naive-ui'
import { personalAgentHost } from './host'
import { personalAgentMessages } from './messages'
import type { DeleteIntent } from './controller'
const props = defineProps<{ standalone?: boolean }>()
const { host, controller: c } = personalAgentHost()
const m = computed(() => personalAgentMessages[host.locale.value] || personalAgentMessages.en)
const entryPreference = localStorage.getItem('studio_entry_mode')
const mode = ref<'choose' | 'workbench' | 'personal'>(props.standalone
  ? entryPreference === 'personal' || entryPreference === 'workbench' ? entryPreference : 'choose'
  : entryPreference ? 'personal' : 'choose')
const connectOpen = ref(false); const onboardOpen = ref(false); const deletion = ref<DeleteIntent | null>(null)
const query = ref(''); const path = ref(''); const text = ref(''); const input = ref(''); const label = ref('')
const connection = ref({ origin: '', username: '', password: '', profile: '', sessionId: '' })
const caps = ref({ search: true, read: true, write: false, delete: false })
const options = computed(() => c.targets.value.map(w => ({ value: `${w.deviceId}/${w.id}`, label: `${w.hostname} · ${w.label} · ${w.deviceId.slice(0, 8)}` })))
watch(c.file, value => { if (value) { path.value = value.path; text.value = value.text } })
function choose(value: 'personal' | 'workbench') {
  localStorage.setItem('studio_entry_mode', value)
  if (value === 'workbench' && !props.standalone && host.openWorkbench) { void host.openWorkbench(); return }
  mode.value = value
}
async function connect() { try { await c.connect({ ...connection.value }); if (c.central.value.connected) connectOpen.value = false } finally { connection.value.password = '' } }
async function onboard() { try { await host.chooseWorkspace?.(label.value, (Object.keys(caps.value) as Array<keyof typeof caps.value>).filter(key => caps.value[key])); onboardOpen.value = false; await c.refresh() } catch { c.error.value = 'ONBOARDING_UNAVAILABLE' } }
async function confirmDelete() { const value = deletion.value; if (!value) return; await c.confirmDelete(value); deletion.value = null }
onMounted(() => { void c.refresh(); void c.refreshCentral() })
</script>

<template>
  <section class="personal-page" :class="{ dark: host.theme.value === 'dark' }" :dir="host.locale.value === 'ar' ? 'rtl' : 'ltr'">
    <header class="page-header"><div><div class="eyebrow">EKKO STUDIO / PERSONAL LAB</div><h1>{{ m.title }}</h1><p>{{ m.subtitle }}</p></div><NSpace><NButton :type="mode === 'workbench' ? 'primary' : 'default'" @click="choose('workbench')">{{ m.workbench }}</NButton><NButton :type="mode === 'personal' ? 'primary' : 'default'" @click="choose('personal')">{{ m.personal }}</NButton></NSpace></header>
    <NCard v-if="mode === 'choose'" class="mode-chooser" :title="m.chooseMode"><p>{{ m.subtitle }}</p><NSpace><NButton size="large" @click="choose('workbench')">{{ m.workbench }}</NButton><NButton size="large" type="primary" @click="choose('personal')">{{ m.personal }}</NButton></NSpace></NCard>
    <template v-else>
      <NAlert v-if="c.error.value" class="error" type="error" role="alert">{{ c.error.value }}</NAlert>
      <div class="panels" :class="{ conversation: mode === 'workbench' }">
        <NCard :title="m.central" class="central-card"><template #header-extra><NTag :type="c.central.value.connected ? 'success' : 'default'">{{ c.central.value.connected ? m.connected : '—' }}</NTag></template>
          <NAlert v-if="!c.central.value.connected" type="info" :show-icon="false">{{ m.notConnected }}</NAlert>
          <p v-if="c.central.value.connected" class="authority">{{ c.central.value.origin }}<br>{{ c.central.value.principal?.username }} / {{ c.central.value.profile }} / {{ c.central.value.sessionId }}<span v-if="c.central.value.clientTaskId"> / {{ c.central.value.clientTaskId }}</span></p>
          <NButton class="connect-button" @click="connectOpen = true">{{ m.connect }}</NButton>
          <div class="messages" aria-live="polite"><p v-if="c.central.value.connected && !c.messages.value.length">{{ m.historyEmpty }}</p><article v-for="(message, index) in c.messages.value" :key="index" :class="message.role"><small>{{ message.role }}</small><pre>{{ message.content }}</pre></article><article v-if="c.draft.value"><small>{{ c.runState.value }}</small><pre>{{ c.draft.value }}</pre></article></div>
          <NInput v-model:value="input" type="textarea" :input-props="{ 'aria-label': m.central }" :disabled="!c.central.value.connected" :autosize="{ minRows: 2, maxRows: 5 }" />
          <div class="send-bar"><small>{{ c.runState.value }}</small><NButton type="primary" :disabled="!c.central.value.connected || !input.trim() || c.busy.value" @click="c.send(input)">{{ m.send }}</NButton></div>
        </NCard>
        <NCard v-if="mode === 'personal'" :title="m.files" class="files-card"><template #header-extra><NButton quaternary :disabled="c.busy.value" @click="c.refresh">{{ m.refresh }}</NButton></template>
          <NFormItem :label="m.target"><NSelect :value="c.selected.value || null" :options="options" :placeholder="m.target" :disabled="c.busy.value" @update:value="c.select" /></NFormItem>
          <p v-if="!c.target.value" class="empty">{{ m.empty }}</p>
          <NButton @click="onboardOpen = true" :disabled="!host.chooseWorkspace">{{ m.chooseFolder }}</NButton><small v-if="!host.chooseWorkspace" class="native-hint">{{ m.nativeOnly }}</small>
          <div v-if="c.target.value" class="target-summary"><div>{{ m.hostname }}: {{ c.target.value.hostname }} · {{ c.target.value.label }}</div><code>{{ m.device }}: {{ c.target.value.deviceId }}<br>{{ m.workspace }}: {{ c.target.value.id }}</code><p>{{ m.readonly }}</p><NSpace><NTag v-for="cap in c.target.value.capabilities" :key="cap" size="small">{{ cap }}</NTag></NSpace></div>
          <NAlert v-for="peer in c.state.value.peers.filter(p => !p.available)" :key="peer.deviceId + peer.workspaceId" type="warning">{{ peer.deviceId }} / {{ peer.workspaceId }}: {{ peer.error }}</NAlert>
          <template v-if="c.target.value">
            <div class="search-bar"><NInput v-model:value="query" :placeholder="m.search" :input-props="{ 'aria-label': m.search }" @keyup.enter="c.search(query)" /><NButton :disabled="c.busy.value || !query || !c.target.value.capabilities.includes('search')" @click="c.search(query)">{{ m.search }}</NButton></div>
            <ul class="results"><li v-for="item in c.items.value" :key="item.path"><NButton text :disabled="c.busy.value || !c.target.value.capabilities.includes('read')" @click="c.read(item.path)">{{ item.path }}</NButton><small>{{ item.size }} B</small></li></ul><NButton v-if="c.cursor.value" @click="c.search(query, true)">{{ m.more }}</NButton>
            <NFormItem :label="m.path"><NInput v-model:value="path" :input-props="{ 'aria-label': m.path }" :disabled="c.busy.value" /></NFormItem><NButton :disabled="!path || c.busy.value || !c.target.value.capabilities.includes('read')" @click="c.read(path)">{{ m.content }}</NButton>
            <NInput v-model:value="text" class="editor" type="textarea" :input-props="{ 'aria-label': m.content }" :disabled="c.busy.value" :autosize="{ minRows: 6, maxRows: 15 }" />
            <p v-if="c.file.value?.truncated">{{ m.truncated }}</p><code v-if="c.file.value" class="file-hash">SHA-256 {{ c.file.value.sha256 }}</code>
            <NSpace class="actions"><NButton :disabled="!path || c.busy.value || !c.target.value.capabilities.includes('write')" @click="c.write(path, text, 'create')">{{ m.create }}</NButton><NButton :disabled="c.busy.value || c.file.value?.path !== path || c.file.value?.truncated || !c.target.value.capabilities.includes('write')" @click="c.write(path, text, 'overwrite')">{{ m.overwrite }}</NButton><NButton type="error" secondary :disabled="c.busy.value || !c.file.value || !c.target.value.capabilities.includes('delete')" @click="deletion = c.prepareDelete()">{{ m.remove }}</NButton></NSpace>
          </template>
          <div v-if="c.result.value" class="operation-result" aria-live="polite"><NTag>{{ c.result.value.outcome }}</NTag> {{ c.result.value.action }}<code>{{ c.result.value.target.hostname }} / {{ c.result.value.target.deviceId }} / {{ c.result.value.target.workspaceId }}</code><pre v-if="'state' in c.result.value.data">{{ c.result.value.data.state }}</pre></div>
          <NButton v-if="c.pendingOperation.value" @click="c.status">{{ m.status }}</NButton><NButton v-if="c.receipt.value" @click="c.restore">{{ m.restore }}</NButton>
          <div v-for="grant in c.state.value.grants || []" :key="grant.id" class="grant"><code>{{ grant.workspaceId }}</code><NButton size="small" :disabled="c.busy.value || !grant.capabilities.length" @click="c.revoke(grant.id, grant.grantRevision)">{{ m.revoke }}</NButton></div>
        </NCard>
      </div>
    </template>
    <NModal :show="connectOpen" preset="card" class="personal-modal" :title="m.connect" :mask-closable="false" @update:show="connectOpen = $event"><form @submit.prevent="connect"><NFormItem v-for="key in ['origin', 'username', 'password', 'profile', 'sessionId'] as const" :key="key" :label="m[key === 'sessionId' ? 'session' : key]"><NInput v-model:value="connection[key]" :type="key === 'password' ? 'password' : 'text'" :input-props="{ autocomplete: key === 'password' ? 'current-password' : 'off', 'aria-label': m[key === 'sessionId' ? 'session' : key] }" /></NFormItem><NAlert v-if="c.error.value" type="error">{{ c.error.value }}</NAlert><NSpace justify="end"><NButton @click="connectOpen = false; connection.password = ''">{{ m.cancel }}</NButton><NButton attr-type="submit" type="primary" :loading="c.busy.value">{{ m.connect }}</NButton></NSpace></form></NModal>
    <NModal :show="onboardOpen" preset="card" class="personal-modal" :title="m.chooseFolder" @update:show="onboardOpen = $event"><NFormItem :label="m.workspace"><NInput v-model:value="label" :input-props="{ 'aria-label': m.workspace }" :maxlength="128" /></NFormItem><NSpace><NCheckbox v-for="cap in ['search', 'read', 'write', 'delete'] as const" :key="cap" v-model:checked="caps[cap]">{{ cap }}</NCheckbox></NSpace><p>{{ m.readonly }}</p><NButton type="primary" :disabled="!label.trim()" @click="onboard">{{ m.chooseFolder }}</NButton></NModal>
    <NModal :show="!!deletion" preset="card" class="personal-modal" :title="m.confirm" :mask-closable="false" @update:show="deletion = null"><dl><dt>{{ m.hostname }}</dt><dd>{{ c.target.value?.hostname }} / {{ c.target.value?.label }}</dd><dt>{{ m.device }}</dt><dd>{{ deletion?.deviceId }}</dd><dt>{{ m.workspace }}</dt><dd>{{ deletion?.workspaceId }}</dd><dt>{{ m.path }}</dt><dd>{{ deletion?.path }}</dd><dt>{{ m.hash }}</dt><dd>{{ deletion?.expectedSha256 }}</dd></dl><NSpace justify="end"><NButton @click="deletion = null">{{ m.cancel }}</NButton><NButton type="error" :loading="c.busy.value" @click="confirmDelete">{{ m.confirm }}</NButton></NSpace></NModal>
  </section>
</template>

<style scoped>
.personal-page { color: #252a30; background: #f5f6f8; min-height: 100%; padding: 32px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; box-sizing: border-box; }
.personal-page.dark { color: #e2e5eb; background: #16181d; }
.page-header { display: flex; justify-content: space-between; gap: 24px; align-items: center; margin-bottom: 28px; }
.eyebrow { color: #566376; font-size: 11px; letter-spacing: .14em; font-weight: 650; }
h1 { font-size: 28px; letter-spacing: -.04em; margin: 8px 0; font-weight: 650; }
p { line-height: 1.6; color: #637082; margin: 8px 0 18px; }
.panels { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 24px; }
.panels.conversation { grid-template-columns: 1fr; max-width: 960px; margin: auto; }
.mode-chooser { max-width: 600px; margin: 64px auto; }.error { margin-bottom: 20px; }.connect-button { margin-top: 16px; }
.authority, code, dd { overflow-wrap: anywhere; font-size: 12px; } code { display: block; color: #617086; }.target-summary { border-block: 1px solid #dce1e7; margin: 20px 0; padding: 16px 0; font-size: 13px; }.target-summary p { margin-bottom: 8px; }
.messages { min-height: 200px; max-height: 380px; overflow: auto; margin: 20px 0; }.messages article { background: #f0f3f6; border-radius: 12px; padding: 12px 16px; margin-bottom: 12px; }.messages .user { background: #edf5f0; }.dark .messages article { background: #252932; } pre { white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; line-height: 1.65; margin: 6px 0; }
.send-bar, .search-bar, .grant { display: flex; gap: 10px; align-items: center; justify-content: space-between; margin-top: 12px; }.search-bar { margin: 20px 0 8px; }.grant { padding: 12px 0; border-top: 1px solid #dce1e7; }.grant code { max-width: 65%; }.editor, .actions, .operation-result { margin-top: 16px; }.file-hash { margin-top: 10px; font-size: 10px; }.results { list-style: none; padding: 0; max-height: 200px; overflow: auto; }.results li { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid #dce1e7; }.native-hint { display: block; margin-top: 8px; }.empty { padding: 24px 0; }dt { font-size: 12px; color: #6a7585; margin-top: 12px; }dd { margin: 5px 0 12px; }
@media(max-width: 720px) { .personal-page { padding: 20px 16px; }.page-header { align-items: flex-start; flex-direction: column; gap: 12px; }.panels { grid-template-columns: minmax(0, 1fr); gap: 16px; }h1 { font-size: 24px; }.messages { min-height: 100px; }.mode-chooser { margin: 24px auto; } }
</style>
<style>.personal-modal { width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 40px); overflow-y: auto; }</style>
