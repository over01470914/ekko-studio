import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/hermes/app'
import { useChatStore } from '@/stores/hermes/chat'
import { useProfilesStore } from '@/stores/hermes/profiles'
import { useSettingsStore } from '@/stores/hermes/settings'
import { loadChatEnhancement, withChatInitializationWarning } from '@/utils/chat-initialization'

export function useChatRouteInitialization(contentMode: Readonly<Ref<string>>) {
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
  function invalidateSessionSelection() {
    chatStore.invalidateSessionSelection()
  }

  onUnmounted(() => {
    disposed = true
    routeLoadSequence++
    controller?.abort()
    if (initializing.value || routeLoading.value || chatStore.isLoadingSessions || chatStore.isLoadingMessages) invalidateSessionSelection()
  })

  async function applyRouteProfile(isCurrent: () => boolean) {
    const profile = routeProfile.value
    if (!profile || profile === profilesStore.activeProfileName) return
    if (!profilesStore.profiles.some(item => item.name === profile)) return
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
    if (profile !== oldProfile || routeSessionId.value !== chatStore.activeSessionId
      || initializing.value || routeLoading.value || chatStore.isLoadingSessions || chatStore.isLoadingMessages) {
      invalidateSessionSelection()
    }
    void loadChatRoute()
  }, { flush: 'sync' })
  return { pageLoading, initializationError, loadChatRoute }
}
