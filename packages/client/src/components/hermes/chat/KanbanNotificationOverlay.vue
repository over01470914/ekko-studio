<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useKanbanNotifications } from '@/composables/useKanbanNotifications'
import { useKanbanReportingCapabilities } from '@/composables/useKanbanReportingCapabilities'
import KanbanCreateForm from '../kanban/KanbanCreateForm.vue'
const props = defineProps<{ sessionId: string | null; profile: string }>()
const { t } = useI18n()
const capabilities = useKanbanReportingCapabilities()
const createOrigin = ref<string | null>(null)
watch(() => [props.sessionId, props.profile, capabilities.value.enabled], () => { createOrigin.value = null })
const target = computed(() => capabilities.value.enabled && props.sessionId ? { id: props.sessionId, profile: props.profile } : null)
const { state, error, unavailable, busy, unsubscribe } = useKanbanNotifications(target)
const subscriptions = computed(() => state.value.subscriptions.filter(s => s.active !== false))
</script>
<template>
  <section v-if="capabilities.enabled && sessionId && !unavailable" class="kanban-session-reporting">
  <NButton v-if="capabilities.enabled && sessionId" size="tiny" class="kanban-create-from-session" @click="createOrigin = sessionId">{{ t('kanban.notifications.createFromSession') }}</NButton>
  <KanbanCreateForm v-if="createOrigin" :origin-session-id="createOrigin" @close="createOrigin = null" />
  <details v-if="subscriptions.length || state.notifications.length || error" class="kanban-notification-overlay" open data-testid="kanban-notification-overlay">
    <summary>{{ t('kanban.notifications.title') }} <span v-if="error" role="status">{{ t('kanban.notifications.loadFailed') }}</span></summary>
    <div class="notices" aria-live="polite">
      <article v-for="notice in state.notifications" :key="notice.id" :data-notification-id="notice.id">
        <strong dir="auto">{{ notice.label }}</strong>
        <div>{{ notice.board }} · {{ notice.task_id }} · {{ notice.kind }} · {{ new Date(notice.occurred_at * 1000).toLocaleString() }}</div>
        <p v-if="notice.summary" dir="auto">{{ notice.summary }}</p>
      </article>
    </div>
    <div v-for="subscription in subscriptions" :key="subscription.id" class="subscription">
      <span>{{ subscription.board }} · {{ subscription.task_id }}</span>
      <NButton size="tiny" :disabled="busy" @click="unsubscribe(subscription.id)">{{ t('kanban.notifications.unsubscribe') }}</NButton>
    </div>
  </details>
  </section>
</template>
<style scoped lang="scss">
.kanban-session-reporting { flex: 0 0 auto; min-width: 0; max-height: 30%; overflow: auto; padding: 8px 16px; border-bottom: 1px solid var(--border-color); font-size: 12px; }
.kanban-create-from-session { margin-bottom: 4px; }
.kanban-notification-overlay { overflow-wrap: anywhere; }
summary { cursor: pointer; }
article { padding: 8px 0; }
p { white-space: pre-wrap; margin: 4px 0; }
.subscription { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0; }
</style>
