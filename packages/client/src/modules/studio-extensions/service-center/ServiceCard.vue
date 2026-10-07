<script setup lang="ts">
import { NButton, NTag } from 'naive-ui'
import type { HealthResult, ServiceEntry } from './api'
import { useServiceCenterTranslation } from './translation'
const props = defineProps<{ service: ServiceEntry; favorite: boolean; health?: HealthResult; canEdit: boolean }>()
const emit = defineEmits<{ favorite: []; check: []; edit: []; approve: []; remove: [] }>()
const t = useServiceCenterTranslation()
const iconGlyphs: Record<string, string> = { globe: '◎', server: '▤', cloud: '☁', tool: '⌘', database: '▥', monitor: '▣', folder: '▧', shield: '◇' }
</script>

<template>
  <article class="service-card" :data-service-id="props.service.id">
    <div class="service-card__top">
      <span class="service-card__icon" aria-hidden="true">{{ iconGlyphs[props.service.icon] || '◎' }}</span>
      <NButton quaternary circle size="small" :aria-label="props.favorite ? t('serviceCenter.unfavorite') : t('serviceCenter.favorite')" @click="emit('favorite')">{{ props.favorite ? '★' : '☆' }}</NButton>
    </div>
    <a class="service-card__link" :href="props.service.url" target="_blank" rel="noopener noreferrer">
      <strong>{{ props.service.name }} <span aria-hidden="true">↗</span></strong>
    </a>
    <p>{{ props.service.description || t('serviceCenter.noDescription') }}</p>
    <div class="service-card__tags">
      <NTag size="small" :bordered="false">{{ props.service.category }}</NTag>
      <NTag size="small" :bordered="false" type="info">{{ t(`serviceCenter.network.${props.service.network}`) }}</NTag>
      <NTag v-for="tag in props.service.tags" :key="tag" size="small" :bordered="false">{{ tag }}</NTag>
    </div>
    <div class="service-card__bottom">
      <span class="service-card__health" :title="props.health?.checkedAt || ''">
        <span class="service-card__dot" :class="`service-card__dot--${props.health?.state || 'untested'}`" />
        {{ t(`serviceCenter.health.${props.health?.state || 'untested'}`) }}
        <span v-if="props.health?.status"> · HTTP {{ props.health.status }}</span>
        <span v-if="props.health?.checkedAt"> · {{ new Date(props.health.checkedAt).toLocaleString() }}</span>
      </span>
      <NButton v-if="props.service.healthCheckEnabled" text size="tiny" @click="emit('check')">{{ t('serviceCenter.check') }}</NButton>
    </div>
    <div v-if="props.canEdit" class="service-card__actions">
      <NButton size="small" secondary @click="emit('edit')">{{ t('serviceCenter.edit') }}</NButton>
      <NButton v-if="props.service.healthUrl" size="small" secondary @click="emit('approve')">{{ props.health?.state === 'unapproved' ? t('serviceCenter.approve') : t('serviceCenter.revokeApproval') }}</NButton>
      <NButton size="small" secondary type="error" @click="emit('remove')">{{ t('serviceCenter.delete') }}</NButton>
    </div>
  </article>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;
.service-card { display: flex; flex-direction: column; min-width: 0; padding: 20px; border: 1px solid $border-color; border-radius: $radius-md; background: $bg-sidebar-surface; gap: 10px; transition: border-color $transition-fast, transform $transition-fast; }
.service-card:hover { border-color: $accent-primary; transform: translateY(-2px); }
.service-card__top, .service-card__bottom, .service-card__actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.service-card__icon { width: 42px; height: 42px; display: grid; place-items: center; font-size: 25px; border-radius: $radius-sm; background: rgba(var(--accent-primary-rgb), .1); color: $accent-primary; }
.service-card__link { color: $text-primary; text-decoration: none; font-size: 17px; overflow-wrap: anywhere; }
.service-card__link:hover { color: $accent-primary; }
p { margin: 0; color: $text-secondary; font-size: 13px; line-height: 1.5; min-height: 40px; overflow-wrap: anywhere; }
.service-card__tags { display: flex; flex-wrap: wrap; gap: 5px; }
.service-card__bottom { margin-top: auto; padding-top: 12px; border-top: 1px solid $border-color; }
.service-card__health { color: $text-muted; font-size: 11px; min-width: 0; overflow-wrap: anywhere; }
.service-card__dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: $text-muted; margin-inline-end: 3px; }
.service-card__dot--healthy { background: #2fa66b; }
.service-card__dot--unreachable, .service-card__dot--http_error, .service-card__dot--blocked { background: #d9746a; }
.service-card__actions { justify-content: flex-start; flex-wrap: wrap; padding-top: 4px; }
</style>
