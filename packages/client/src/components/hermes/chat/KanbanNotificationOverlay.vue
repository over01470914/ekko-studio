<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NPopover, NTooltip } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useKanbanNotifications } from '@/composables/useKanbanNotifications'
import { useKanbanReportingCapabilities } from '@/composables/useKanbanReportingCapabilities'
import KanbanCreateForm from '../kanban/KanbanCreateForm.vue'
import { groupKanbanNotifications } from '@/utils/hermes/kanban-notifications'
const props = defineProps<{ sessionId: string | null; profile: string }>()
const { t, locale } = useI18n()
const capabilities = useKanbanReportingCapabilities()
const createOrigin = ref<string | null>(null)
const expanded = ref(false)
watch(() => [props.sessionId, props.profile, capabilities.value.enabled], () => {
  createOrigin.value = null
  expanded.value = false
})
const target = computed(() => capabilities.value.enabled && props.sessionId ? { id: props.sessionId, profile: props.profile } : null)
const { state, error, unavailable, busy, unsubscribe } = useKanbanNotifications(target)
const subscriptions = computed(() => state.value.subscriptions.filter(s => s.active !== false))
const groups = computed(() => groupKanbanNotifications(state.value.notifications))
const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))
function createTask() {
  expanded.value = false
  createOrigin.value = props.sessionId
}
</script>
<template>
  <section v-if="capabilities.enabled && sessionId && !unavailable" class="kanban-session-reporting">
    <NPopover v-model:show="expanded" trigger="click" placement="bottom-start" :show-arrow="false" :style="{ padding: '0', maxWidth: 'calc(100vw - 24px)' }">
      <template #trigger>
        <NButton size="tiny" quaternary class="notification-trigger" :aria-expanded="expanded" :aria-label="t('kanban.notifications.title')" @keydown.esc.stop="expanded = false">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
          <span>{{ t('kanban.notifications.title') }}</span>
          <span v-if="state.notifications.length" class="notice-count">{{ state.notifications.length }}</span>
          <span v-if="error" class="error-dot" role="status" :aria-label="t('kanban.notifications.loadFailed')">!</span>
        </NButton>
      </template>
      <div :key="sessionId + ':' + profile" class="notification-panel" data-testid="kanban-notification-overlay" @keydown.esc.stop="expanded = false">
        <header>
          <strong>{{ t('kanban.notifications.title') }}</strong>
          <NButton size="tiny" quaternary :aria-label="t('common.close')" @click="expanded = false">×</NButton>
        </header>
        <div class="notification-scroll">
          <p v-if="error" class="notice-empty" role="status">{{ t('kanban.notifications.loadFailed') }}</p>
          <p v-else-if="!groups.length" class="notice-empty">{{ t('kanban.notifications.empty') }}</p>
          <section v-for="group in groups" :key="group.key" class="task-group">
            <div class="task-meta"><span dir="auto">{{ group.board }}</span><code>{{ group.taskId }}</code></div>
            <details v-for="notice in group.notices.slice(0, 1)" :key="notice.id" class="notice" :data-notification-id="notice.id">
              <summary><span class="notice-label" dir="auto">{{ notice.label }}</span><time :datetime="new Date(notice.occurred_at * 1000).toISOString()">{{ dateFormat.format(notice.occurred_at * 1000) }}</time></summary>
              <p v-if="notice.summary" dir="auto">{{ notice.summary }}</p>
            </details>
            <details v-if="group.notices.length > 1" class="notice-history">
              <summary>{{ t('kanban.notifications.history', { count: group.notices.length - 1 }) }}</summary>
              <details v-for="notice in group.notices.slice(1)" :key="notice.id" class="notice" :data-notification-id="notice.id">
                <summary><span class="notice-label" dir="auto">{{ notice.label }}</span><time :datetime="new Date(notice.occurred_at * 1000).toISOString()">{{ dateFormat.format(notice.occurred_at * 1000) }}</time></summary>
                <p v-if="notice.summary" dir="auto">{{ notice.summary }}</p>
              </details>
            </details>
          </section>
          <details v-if="subscriptions.length" class="subscriptions">
            <summary>{{ t('kanban.notifications.subscriptions', { count: subscriptions.length }) }}</summary>
            <div v-for="subscription in subscriptions" :key="subscription.id" class="subscription">
              <span dir="auto">{{ subscription.board }} · {{ subscription.task_id }}</span>
              <NButton size="tiny" quaternary :disabled="busy" @click="unsubscribe(subscription.id)">{{ t('kanban.notifications.unsubscribe') }}</NButton>
            </div>
          </details>
        </div>
      </div>
    </NPopover>
    <NTooltip>
      <template #trigger>
        <NButton size="tiny" quaternary class="kanban-create-from-session" :aria-label="t('kanban.notifications.createFromSession')" @click="createTask"><span aria-hidden="true">＋</span><span>{{ t('kanban.createTask') }}</span></NButton>
      </template>
      {{ t('kanban.notifications.createFromSession') }}
    </NTooltip>
    <KanbanCreateForm v-if="createOrigin" :origin-session-id="createOrigin" @close="createOrigin = null" />
  </section>
</template>
<style scoped lang="scss">
.kanban-session-reporting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: 0 0 auto;
  min-width: 0;
  padding: 4px 12px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-secondary);
}
.notification-trigger :deep(.n-button__content) { gap: 7px; }
.notice-count { padding: 0 5px; border-radius: 4px; background: var(--bg-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
.error-dot { color: var(--warning); }
.notification-panel { width: min(420px, calc(100vw - 24px)); font-size: 12px; color: var(--text-primary); }
header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--border-color); }
.notification-scroll { max-height: min(440px, 60dvh); overflow: auto; overscroll-behavior: contain; padding: 0 14px; }
.task-group { padding: 12px 0; border-bottom: 1px solid var(--border-color); }
.task-meta { display: flex; gap: 8px; color: var(--text-muted); font-size: 11px; overflow-wrap: anywhere; }
.task-meta span { flex: 1; min-width: 0; }
.task-meta code { flex-shrink: 0; }
summary { cursor: pointer; border-radius: 4px; }
summary:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
.notice > summary { padding: 6px 0; }
.notice-label { font-weight: 500; overflow-wrap: anywhere; }
time { display: block; margin-inline-start: 14px; color: var(--text-muted); font-size: 11px; }
.notice p { white-space: pre-wrap; overflow-wrap: anywhere; margin: 4px 0 8px 14px; color: var(--text-secondary); line-height: 1.65; }
.notice-history > summary, .subscriptions > summary { padding: 6px 0; color: var(--text-secondary); font-size: 11px; }
.notice-history .notice { margin-inline-start: 12px; }
.subscriptions { padding: 8px 0; }
.subscription { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
.subscription > span { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--text-secondary); }
.notice-empty { padding: 18px 0; color: var(--text-muted); text-align: center; }
@media (max-width: 480px) { .kanban-session-reporting { padding-inline: 8px; } }
</style>
