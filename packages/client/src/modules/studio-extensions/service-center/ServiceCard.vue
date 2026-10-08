<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NSelect } from 'naive-ui'
import type { Endpoint, HealthResult, ServiceEntry } from './api'
import { useServiceCenterTranslation } from './translation'
import ServiceIcon from './ServiceIcon.vue'
const props = defineProps<{ service: ServiceEntry; favorite: boolean; health?: HealthResult; nodeName?: string; selectedEndpointId?: string }>()
const emit = defineEmits<{ favorite: []; info: []; select: [id: string] }>()
const t = useServiceCenterTranslation()
const entry = computed<Endpoint | undefined>(() => props.service.endpoints.find(item => item.id === (props.selectedEndpointId || props.service.defaultEndpointId)))
const options = computed(() => props.service.endpoints.map(item => ({ label: item.label, value: item.id })))
</script>
<template>
  <article class="service-card" :data-service-id="props.service.id">
    <div class="service-card__top">
      <span class="service-card__icon"><ServiceIcon :name="props.service.icon" :size="22" /></span>
      <NButton quaternary class="service-card__favorite" :aria-pressed="props.favorite" :aria-label="props.favorite ? t('serviceCenter.unfavorite') : t('serviceCenter.favorite')" @click="emit('favorite')"><ServiceIcon name="star" :size="19" /></NButton>
    </div>
    <h2>{{ props.service.name }}</h2>
    <p v-if="props.service.description" class="service-card__description">{{ props.service.description }}</p>
    <div class="service-card__context">
      <span v-if="props.nodeName" class="service-card__location"><ServiceIcon name="location" :size="15" />{{ props.nodeName }}</span>
      <button class="service-card__network" type="button" @click="emit('info')">{{ t(`serviceCenter.network.${entry?.network || 'public'}`) }}<span v-if="entry?.login === 'required'"> · {{ t('serviceCenter.loginRequired') }}</span></button>
      <button class="service-card__status" type="button" @click="emit('info')"><span class="service-card__dot" :class="`service-card__dot--${props.health?.state || 'untested'}`" />{{ t(`serviceCenter.health.${props.health?.state || 'untested'}`) }}</button>
    </div>
    <div class="service-card__footer">
      <div v-if="props.service.endpoints.length > 1" class="service-card__choice">
        <span>{{ t('serviceCenter.entrance') }}</span>
        <NSelect :value="entry?.id" :options="options" :aria-label="t('serviceCenter.entrance')" size="small" @update:value="value => emit('select', value)" />
      </div>
      <div v-else class="service-card__alias">{{ entry?.label }}</div>
      <div class="service-card__actions">
        <a v-if="entry" class="service-card__open" :href="entry.url" target="_blank" rel="noopener noreferrer">{{ t('serviceCenter.open') }}<ServiceIcon name="external" :size="16" /></a>
        <span v-else>{{ t('serviceCenter.unavailable') }}</span>
        <NButton quaternary class="service-card__info" @click="emit('info')"><ServiceIcon name="info" :size="17" />{{ t('serviceCenter.info') }}</NButton>
      </div>
    </div>
  </article>
</template>
<style scoped lang="scss">
@use '@/styles/variables' as *;
.service-card { display: flex; flex-direction: column; min-width: 0; min-height: 278px; padding: 18px; border: 1px solid $border-color; border-radius: $radius-md; background: $bg-sidebar-surface; gap: 10px; transition: border-color $transition-fast, transform $transition-fast; }
.service-card:hover { border-color: $accent-primary; transform: translateY(-2px); }
.service-card__top, .service-card__actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.service-card__icon { width: 40px; height: 40px; display: grid; place-items: center; border-radius: $radius-sm; background: rgba(var(--accent-primary-rgb), .08); color: $text-secondary; }
.service-card__favorite, .service-card__info { min-width: 44px; min-height: 44px; }
.service-card__favorite[aria-pressed='true'] { color: $accent-primary; }
h2 { margin: 0; font-size: 16px; font-weight: 650; line-height: 1.35; letter-spacing: -.02em; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.service-card__description { margin: 0; color: $text-secondary; font-size: 13px; line-height: 1.5; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
.service-card__context { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; font-size: 13px; color: $text-secondary; }
.service-card__location { display: inline-flex; align-items: center; gap: 5px; overflow-wrap: anywhere; }
.service-card__network, .service-card__status { display: inline-flex; align-items: center; padding: 0; border: 0; background: transparent; color: $text-secondary; font: inherit; text-align: start; cursor: pointer; min-height: 26px; }
.service-card__network:hover, .service-card__status:hover { color: $accent-primary; }
.service-card__dot { width: 7px; height: 7px; border-radius: 50%; background: $text-muted; margin-inline-end: 7px; flex: none; }
.service-card__dot--healthy { background: #2f956b; }
.service-card__dot--unreachable, .service-card__dot--http_error, .service-card__dot--blocked { background: #c76c66; }
.service-card__footer { margin-top: auto; border-top: 1px solid $border-color; padding-top: 10px; }
.service-card__choice { display: grid; gap: 4px; font-size: 12px; color: $text-secondary; }
.service-card__alias { font-size: 12px; color: $text-secondary; min-height: 29px; padding-top: 5px; }
.service-card__actions { margin-top: 7px; }
.service-card__open { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 0 16px; border-radius: $radius-sm; color: white; background: $accent-primary; text-decoration: none; font-size: 13px; font-weight: 600; transition: filter $transition-fast; }
.service-card__open:hover { filter: brightness(1.1); }
.service-card__info { display: inline-flex; gap: 7px; padding-inline: 14px; color: $text-primary; background: $bg-card; border: 1px solid $border-color; border-radius: $radius-sm; }
.service-card__info:hover { border-color: $accent-primary; color: $accent-primary; }
.service-card :is(button, a):focus-visible { outline: 2px solid $accent-primary; outline-offset: 2px; }
</style>