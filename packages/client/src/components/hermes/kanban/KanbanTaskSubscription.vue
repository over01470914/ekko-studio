<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NSelect, NCheckbox, NButton, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { isBuiltinEkkoSession } from '@/utils/hermes/session-agent'
import { useChatStore } from '@/stores/hermes/chat'
import { subscribeKanbanSessionNotification } from '@/api/studio/kanban-notifications'
import { useKanbanReportingCapabilities } from '@/composables/useKanbanReportingCapabilities'
const props = defineProps<{ taskId: string; board: string }>()
const chat = useChatStore()
const { t } = useI18n()
const message = useMessage()
const targetId = ref<string | null>(null)
const wake = ref(false)
const saving = ref(false)
const capabilities = useKanbanReportingCapabilities()
const wakeSupported = computed(() => capabilities.value.diagnosticsEnabled && isBuiltinEkkoSession(chat.sessions.find(s => s.id === targetId.value)))
watch(wakeSupported, supported => { if (!supported) wake.value = false })
let generation = 0
const sessions = computed(() => chat.sessions.filter(s => !s.isLocalOnly))
const options = computed(() => sessions.value.map(s => ({ label: (s.title || s.id) + ' · ' + (s.profile || 'default'), value: s.id })))
watch(() => capabilities.value.enabled, enabled => {
  if (enabled && !chat.sessionsLoaded) void chat.refreshSessionListOnly()
})
watch(() => [props.taskId, props.board], () => { ++generation; targetId.value = null; wake.value = false; saving.value = false })
async function subscribe() {
  const session = sessions.value.find(s => s.id === targetId.value)
  if (!session || saving.value) return
  const current = generation
  saving.value = true
  try {
    await subscribeKanbanSessionNotification(session.id, session.profile || 'default', { board: props.board, task_id: props.taskId, wake_enabled: wakeSupported.value && wake.value })
    if (current === generation) message.success(t('kanban.notifications.subscribed'))
  } catch {
    if (current === generation) message.error(t('kanban.notifications.saveFailed'))
  } finally {
    if (current === generation) saving.value = false
  }
}
</script>
<template>
  <section v-if="capabilities.enabled" class="task-subscription" data-testid="kanban-task-subscription">
    <label>{{ t('kanban.notifications.target') }}</label>
    <NSelect v-model:value="targetId" :options="options" filterable clearable :placeholder="t('kanban.notifications.chooseSession')" />
    <NCheckbox v-if="capabilities.diagnosticsEnabled" v-model:checked="wake" :disabled="!wakeSupported">{{ t('kanban.notifications.wake') }}</NCheckbox>
    <p v-if="capabilities.diagnosticsEnabled">{{ t('kanban.notifications.wakeHint') }}</p>
    <NButton :disabled="!targetId" :loading="saving" @click="subscribe">{{ t('kanban.notifications.subscribe') }}</NButton>
  </section>
</template>
<style scoped lang="scss">
.task-subscription { display: grid; gap: 8px; padding-block: 16px; }
p { margin: 0; font-size: 12px; opacity: .7; }
</style>
