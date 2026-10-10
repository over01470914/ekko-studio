<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import PageLoading from '@/components/common/PageLoading.vue'
import { useRoute, useRouter } from 'vue-router'
import ChatPanel from '@/components/hermes/chat/ChatPanel.vue'
import { useAppStore } from '@/stores/hermes/app'
import { useChatStore } from '@/stores/hermes/chat'
import { useProfilesStore } from '@/stores/hermes/profiles'
import { useSettingsStore } from '@/stores/hermes/settings'
import { loadChatEnhancement, withChatInitializationWarning } from '@/utils/chat-initialization'

const appStore = useAppStore()
const chatStore = useChatStore()
const profilesStore = useProfilesStore()
const settingsStore = useSettingsStore()
const route = useRoute()
const router = useRouter()

const routeSessionId = computed(() => {
  const value = route.params.sessionId
  return typeof value === 'string' && value.trim() ? value : null
})

const routeProfile = computed(() => {
  const value = route.query.profile
  return typeof value === 'string' && value.trim() ? value : null
})

const isStandaloneChat = computed(() => route.meta?.standaloneChat === true)
type ChatContentMode = 'chat' | 'connections' | 'agents' | 'models'

const contentMode = computed<ChatContentMode>(() => {
  if (route.name === 'hermes.connections') return 'connections'
  if (route.name === 'hermes.agentManager') return 'agents'
  if (route.name === 'hermes.models') return 'models'
  return 'chat'
})
const productTitle = 'Ekko Studio'
const initializing = ref(true)
const routeLoading = ref(false)
const initializationError = ref<'timeout' | 'failed' | null>(null)
let controller: AbortController | null = null
let profilesReady = false
let settingsRouteRevision = 0
let requestedSettingsProfile: string | null = null
let routeLoadSequence = 0
let disposed = false
const pageLoading = computed(() => contentMode.value === 'chat' && !initializationError.value && (
  initializing.value || routeLoading.value || chatStore.isLoadingSessions || chatStore.isLoadingMessages
))
const tabTitle = computed(() => {
  if (route.name !== 'hermes.session' && route.name !== 'desktop.chat') return productTitle
  return chatStore.activeSession?.title?.trim() || productTitle
})

watch(tabTitle, (value) => {
  document.title = value
}, { immediate: true })

function invalidateSessionSelection() {
  // switchSession advances the store's selection generation even for an empty
  // id; it then returns false without transport IO. No new draft is created.
  void chatStore.switchSession('').catch(error => console.warn('Failed to invalidate stale chat selection:', error))
}

onUnmounted(() => {
  disposed = true
  routeLoadSequence++
  controller?.abort()
  // The store cannot cancel HTTP requests. Invalidate active selection/message
  // continuations; list metadata may still refresh until a newer list request.
  if (initializing.value || routeLoading.value || chatStore.isLoadingSessions || chatStore.isLoadingMessages) invalidateSessionSelection()
  document.title = productTitle
})

async function applyRouteProfile(isCurrent: () => boolean) {
  const profile = routeProfile.value
  if (!profile || profile === profilesStore.activeProfileName) return
  if (!profilesStore.profiles.some(item => item.name === profile)) return
  // switchProfile commits local selection before awaiting its optional models
  // refresh. Do not make that chained refresh a full-page loading requirement.
  let stop = () => {}
  try {
    await new Promise<void>((resolve, reject) => {
      stop = watch(() => profilesStore.activeProfileName, name => {
        if (name === profile) resolve()
      }, { flush: 'sync' })
      Promise.resolve().then(() => profilesStore.switchProfile(profile)).then(ok => {
        if (!ok) reject(new Error('Profile selection failed'))
        else resolve()
      }, reject)
    })
  } finally { stop() }
  if (isCurrent()) chatStore.setSessionProfileFilter(profile)
}

function loadDisplayPreferences() {
  const profile = profilesStore.activeProfileName
  if (requestedSettingsProfile === profile) return
  requestedSettingsProfile = profile
  const revision = settingsRouteRevision
  loadChatEnhancement(() => settingsStore.fetchSettings({
    shouldCommit: () => !disposed && revision === settingsRouteRevision && profile === profilesStore.activeProfileName,
  }), 'Failed to load display preferences:')
}

async function loadChatRoute() {
  const forceList = !!initializationError.value || chatStore.isLoadingSessions
  if (forceList) invalidateSessionSelection()
  const sequence = ++routeLoadSequence
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  const isCurrent = () => !disposed && sequence === routeLoadSequence && !signal.aborted
  initializationError.value = null
  routeLoading.value = true
  try {
    await withChatInitializationWarning(async () => {
      if (!profilesReady) {
        await profilesStore.fetchProfiles()
        if (!isCurrent()) return
        profilesReady = true
        chatStore.validateSessionProfileFilter(profilesStore.profiles.map(profile => profile.name))
      }
      await applyRouteProfile(isCurrent)
      if (!isCurrent()) return
      loadDisplayPreferences()
      const sessionId = routeSessionId.value
      if (forceList || !chatStore.sessionsLoaded || !sessionId || !chatStore.sessions.some(session => session.id === sessionId)) {
        const loaded = await chatStore.loadSessions(chatStore.sessionProfileFilter, sessionId)
        if (!isCurrent()) return
        if (loaded === false) throw new Error('Session list or messages failed to load')
        if (sessionId && chatStore.activeSessionId !== sessionId) await router.replace({ name: 'hermes.chat' })
      } else if (chatStore.activeSessionId !== sessionId || chatStore.isLoadingMessages) {
        const loaded = await chatStore.switchSession(sessionId)
        if (isCurrent() && loaded === false) throw new Error('Session messages failed to load')
      }
    }, signal, () => {
      if (isCurrent()) initializationError.value = 'timeout'
    })
    if (isCurrent()) initializationError.value = null
  } catch (error) {
    if (!isCurrent()) return
    initializationError.value = 'failed'
    // Keep the failed surface non-interactive. Retry starts a newer list request
    // to invalidate old list writes using the store's existing sequence guard.
    invalidateSessionSelection()
    console.error('Failed to initialize chat page:', error)
    controller.abort()
  } finally {
    if (!disposed && sequence === routeLoadSequence) {
      initializing.value = false
      routeLoading.value = false
    }
  }
}

onMounted(() => {
  chatStore.setRuntimeMode('default')
  loadChatEnhancement(() => appStore.loadModels(false, { preserveSelection: true }), 'Failed to load model capabilities:')
  loadDisplayPreferences()
  void loadChatRoute()
})

watch([routeSessionId, routeProfile, contentMode], ([, profile, mode], [, oldProfile]) => {
  if (profile !== oldProfile) { settingsRouteRevision++; requestedSettingsProfile = null }
  if (mode !== 'chat') {
    routeLoadSequence++
    controller?.abort()
    if (initializing.value || routeLoading.value || chatStore.isLoadingSessions || chatStore.isLoadingMessages) invalidateSessionSelection()
    initializationError.value = null
    initializing.value = false
    routeLoading.value = false
    return
  }
  // Supersede even the initial wait; never redirect a newer deep link from an
  // old continuation. A newer list request invalidates old store list writes.
  invalidateSessionSelection()
  void loadChatRoute()
}, { flush: 'sync' })
</script>

<template>
  <PageLoading :show="pageLoading" :initial-only="contentMode === 'chat'" class="chat-view" :class="{ 'chat-view--standalone': isStandaloneChat }">
    <div v-if="initializationError && contentMode === 'chat'" class="chat-initialization-error" role="alert">
      <span>{{ $t(initializationError === 'timeout' ? 'common.chatLoadingTimeout' : 'common.chatLoadingFailed') }}</span>
      <button type="button" @click="loadChatRoute">{{ $t('common.retry') }}</button>
    </div>
    <ChatPanel
      v-else
      :standalone="isStandaloneChat"
      :content-mode="contentMode"
    />
  </PageLoading>
</template>

<style scoped lang="scss">
.chat-initialization-error {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.chat-view {
  height: 100%;
  display: flex;
  flex-direction: column;

  &--standalone {
    height: 100%;
  }
}
</style>
