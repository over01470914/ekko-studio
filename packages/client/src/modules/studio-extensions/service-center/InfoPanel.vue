<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { NButton } from 'naive-ui'
import type { Category, DeploymentNode, HealthResult, ServiceEntry } from './api'
import { useServiceCenterTranslation } from './translation'
import ServiceIcon from './ServiceIcon.vue'
const props = defineProps<{ open: boolean; service: ServiceEntry | null; category?: Category; node?: DeploymentNode; health?: HealthResult; selectedEndpointId?: string; canEdit: boolean }>()
const emit = defineEmits<{ close: []; edit: []; remove: []; check: []; approve: [] }>()
const t = useServiceCenterTranslation()
const panel = ref<HTMLElement | null>(null)
let opener: HTMLElement | null = null
watch(() => props.open, async (open, previous) => {
  if (open) { opener = document.activeElement as HTMLElement; await nextTick(); panel.value?.focus() }
  else if (previous) { await nextTick(); opener?.focus(); opener = null }
})
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); return }
  if (event.key !== 'Tab' || !panel.value) return
  const focusable = [...panel.value.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
  if (!focusable.length) { event.preventDefault(); return }
  const first = focusable[0], last = focusable[focusable.length - 1]
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
</script>
<template>
  <Teleport to="body">
    <div v-if="props.open" class="sc-panel__layer">
      <div class="sc-panel__backdrop" @click="emit('close')" />
      <aside ref="panel" class="sc-panel" role="dialog" aria-modal="true" :aria-label="props.service?.name || t('serviceCenter.legend')" tabindex="-1" @keydown="onKeydown">
        <header class="sc-panel__head">
          <div><small>{{ t('serviceCenter.info') }}</small><h2>{{ props.service?.name || t('serviceCenter.legend') }}</h2></div>
          <button type="button" class="sc-panel__close" :aria-label="t('serviceCenter.close')" @click="emit('close')"><ServiceIcon name="close" /></button>
        </header>
        <div class="sc-panel__body">
          <template v-if="props.service">
            <section><h3>{{ t('serviceCenter.overview') }}</h3><p v-if="props.service.description">{{ props.service.description }}</p><dl><dt>{{ t('serviceCenter.category') }}</dt><dd>{{ props.category?.name || t('serviceCenter.uncategorized') }}</dd><dt>{{ t('serviceCenter.deployment') }}</dt><dd>{{ props.node?.name || t('serviceCenter.unknownLocation') }}<p v-if="props.node?.description">{{ props.node.description }}</p></dd></dl><div v-if="props.service.tags.length" class="sc-panel__tags"><span v-for="tag in props.service.tags" :key="tag">{{ tag }}</span></div></section>
            <section><h3>{{ t('serviceCenter.entrances') }}</h3>
              <article v-for="entry in props.service.endpoints" :key="entry.id" class="sc-panel__entry">
                <strong>{{ entry.label }} <small v-if="entry.id === props.service.defaultEndpointId">{{ t('serviceCenter.defaultEntry') }}</small><small v-if="entry.id === props.selectedEndpointId && entry.id !== props.service.defaultEndpointId">{{ t('serviceCenter.selectedEntry') }}</small></strong>
                <a :href="entry.url" target="_blank" rel="noopener noreferrer">{{ entry.url }}</a>
                <span>{{ t(`serviceCenter.network.${entry.network}`) }} · {{ t(`serviceCenter.login.${entry.login}`) }}</span>
                <p v-if="entry.network === 'local'">{{ t('serviceCenter.localWarning') }}</p>
              </article>
            </section>
            <section><h3>{{ t('serviceCenter.backendCheck') }}</h3><p>{{ t(`serviceCenter.health.${props.health?.state || 'untested'}`) }}</p><p v-if="props.service.healthUrl" class="sc-panel__url">{{ props.service.healthUrl }}</p><p v-if="props.health?.status">HTTP {{ props.health.status }} · {{ props.health.latencyMs }}ms</p><p v-if="props.health?.checkedAt">{{ new Date(props.health.checkedAt).toLocaleString() }}</p><p>{{ t('serviceCenter.reachability') }}</p>
              <NButton v-if="props.service.healthCheckEnabled" @click="emit('check')">{{ t('serviceCenter.check') }}</NButton>
            </section>
            <section v-if="props.canEdit" class="sc-panel__manage"><h3>{{ t('serviceCenter.management') }}</h3><NButton @click="emit('edit')">{{ t('serviceCenter.edit') }}</NButton><NButton v-if="props.service.healthUrl" @click="emit('approve')">{{ props.health?.state === 'unapproved' ? t('serviceCenter.approve') : t('serviceCenter.revokeApproval') }}</NButton><NButton type="error" secondary @click="emit('remove')">{{ t('serviceCenter.delete') }}</NButton></section>
          </template>
          <section><h3>{{ t('serviceCenter.legend') }}</h3><dl class="sc-panel__legend"><template v-for="network in (['local', 'lan', 'tailscale', 'public'] as const)" :key="network"><dt>{{ t(`serviceCenter.network.${network}`) }}</dt><dd>{{ t(`serviceCenter.legendNetwork.${network}`) }}</dd></template><dt>{{ t('serviceCenter.loginRequired') }}</dt><dd>{{ t('serviceCenter.legendLogin') }}</dd><dt>{{ t('serviceCenter.backendCheck') }}</dt><dd>{{ t('serviceCenter.legendHealth') }}</dd></dl></section>
        </div>
      </aside>
    </div>
  </Teleport>
</template>
<style scoped lang="scss">
@use '@/styles/variables' as *;
.sc-panel__layer { position: fixed; inset: 0; z-index: 2000; }
.sc-panel__backdrop { position: absolute; inset: 0; background: rgba(16, 22, 30, .48); }
.sc-panel { position: absolute; inset-block: 0; inset-inline-end: 0; width: min(480px, 100vw); display: flex; flex-direction: column; background: $bg-card; color: $text-primary; box-shadow: -12px 0 45px rgba(16, 22, 30, .16); outline: none; }
.sc-panel__head { padding: 24px 28px 18px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 1px solid $border-color; }
.sc-panel__head small { color: $text-secondary; font-size: 11px; letter-spacing: .1em; }
.sc-panel__head h2 { margin: 5px 0 0; font-size: 22px; line-height: 1.25; overflow-wrap: anywhere; }
.sc-panel__close { flex: none; width: 44px; height: 44px; display: grid; place-items: center; border: 1px solid $border-color; border-radius: $radius-sm; background: transparent; color: $text-primary; cursor: pointer; }
.sc-panel__body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 8px 28px 40px; scrollbar-color: $border-color transparent; }
.sc-panel section { padding: 14px 0; border-bottom: 1px solid $border-color; }
.sc-panel h3 { font-size: 13px; margin: 0 0 12px; }
.sc-panel p { font-size: 13px; line-height: 1.55; margin: 8px 0; color: $text-secondary; overflow-wrap: anywhere; }
.sc-panel dl { display: grid; grid-template-columns: 110px minmax(0,1fr); gap: 8px; margin: 8px 0; font-size: 13px; }
.sc-panel dt { color: $text-secondary; }.sc-panel dd { margin: 0; overflow-wrap: anywhere; }
.sc-panel__tags { display: flex; gap: 6px; flex-wrap: wrap; }.sc-panel__tags span { padding: 4px 9px; background: $bg-sidebar-surface; border-radius: $radius-sm; font-size: 12px; }
.sc-panel__entry { padding: 13px; border: 1px solid $border-color; border-radius: $radius-sm; margin: 9px 0; display: grid; gap: 6px; font-size: 13px; }.sc-panel__entry a, .sc-panel__url { overflow-wrap: anywhere; word-break: break-word; }.sc-panel__entry small { font-size: 11px; font-weight: 400; color: $accent-primary; }.sc-panel__entry span { color: $text-secondary; }.sc-panel__entry p { margin: 2px 0 0; padding: 9px 12px; border-inline-start: 2px solid $accent-primary; background: $bg-sidebar-surface; color: $text-primary; }
.sc-panel__manage { display: flex; flex-wrap: wrap; gap: 8px; }.sc-panel__manage h3 { flex-basis: 100%; }.sc-panel :is(button, a):focus-visible { outline: 2px solid $accent-primary; outline-offset: 2px; }
@media (max-width: 640px) { .sc-panel__head { padding: 18px 18px 12px; }.sc-panel__body { padding: 6px 18px 32px; }.sc-panel dl { grid-template-columns: 90px minmax(0,1fr); } }
</style>
