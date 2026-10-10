<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import boring from 'boring-avatars-vanilla'
import type { ProfileAvatar } from '@/api/hermes/profiles'
import { getApiKey, getBaseUrlValue } from '@/api/client'
import { resolveLibraryAvatar } from '@/utils/avatar-library'

const props = withDefaults(defineProps<{
  name: string
  avatar?: ProfileAvatar | null
  size?: number
}>(), {
  size: 24,
})

const fallbackSeed = computed(() => props.name || 'default')
const imageUrl = ref('')
let objectUrl = ''
watch(() => props.avatar, async (avatar, _, onCleanup) => {
  let cancelled = false
  onCleanup(() => { cancelled = true })
  imageUrl.value = ''
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = '' }
  const url = avatar?.type === 'library' ? resolveLibraryAvatar(avatar)?.url : avatar?.type === 'image' ? avatar.dataUrl || avatar.url : undefined
  if (!url) return
  if (!url.startsWith('/api/')) { imageUrl.value = url; return }
  try {
    const token = getApiKey()
    const response = await fetch(`${getBaseUrlValue()}${url}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!response.ok) return
    const blob = await response.blob()
    if (cancelled) return
    objectUrl = URL.createObjectURL(blob)
    imageUrl.value = objectUrl
  } catch { /* safe fallback */ }
}, { immediate: true })
onBeforeUnmount(() => { if (objectUrl) URL.revokeObjectURL(objectUrl) })
const generatedSvg = computed(() => boring({
  name: props.avatar?.seed || fallbackSeed.value,
  variant: 'beam',
  size: props.size,
}))
const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  flexBasis: `${props.size}px`,
}))
</script>

<template>
  <span class="profile-avatar-view" :style="style">
    <img
      v-if="imageUrl"
      class="profile-avatar-image"
      :src="imageUrl"
      alt=""
      draggable="false"
    >
    <span v-else class="profile-avatar-svg" v-html="generatedSvg" />
  </span>
</template>

<style scoped>
.profile-avatar-view {
  display: inline-flex;
  flex: 0 0 auto;
  border-radius: 50%;
  overflow: hidden;
  background: var(--bg-secondary);
}

.profile-avatar-image,
.profile-avatar-svg,
.profile-avatar-svg :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

.profile-avatar-image {
  object-fit: cover;
}
</style>
