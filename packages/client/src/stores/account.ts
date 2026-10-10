import { computed, onScopeDispose, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { getStoredUsername } from '@/api/client'
import { fetchCurrentUser, fetchMyAvatar, type UserAvatar } from '@/api/studio/auth'
import { onAuthInvalidated } from '@/api/auth-invalidation'

export const useAccountStore = defineStore('account', () => {
  const username = ref(getStoredUsername() || '')
  const avatar = ref<UserAvatar | null>(null)
  const profileAvatar = computed(() => avatar.value?.type === 'image' || avatar.value?.type === 'library' ? avatar.value : null)
  let loaded = false
  let pending: Promise<void> | null = null
  let generation = 0
  let nameRevision = 0
  let avatarRevision = 0
  const lifetimeCleanups = new Set<() => void>()
  watch(username, () => { nameRevision++ }, { flush: 'sync' })
  watch(avatar, () => { avatarRevision++ }, { flush: 'sync' })
  const stopInvalidation = onAuthInvalidated(() => {
    generation++
    pending = null
    loaded = false
    username.value = getStoredUsername() || ''
    avatar.value = null
  })
  onScopeDispose(() => {
    generation++
    pending = null
    stopInvalidation()
    for (const cleanup of lifetimeCleanups) cleanup()
    lifetimeCleanups.clear()
  })

  function onAccountDisposed(cleanup: () => void): void {
    lifetimeCleanups.add(cleanup)
  }

  function loadAccount(): Promise<void> {
    if (pending) return pending
    if (loaded) return Promise.resolve()
    const source = generation
    const nameAtStart = nameRevision
    const avatarAtStart = avatarRevision
    const request = Promise.allSettled([fetchCurrentUser(), fetchMyAvatar()])
      .then(([userResult, avatarResult]) => {
        if (source !== generation) return
        if (userResult.status === 'fulfilled' && nameRevision === nameAtStart) username.value = userResult.value.username
        if (avatarResult.status === 'fulfilled' && avatarRevision === avatarAtStart) avatar.value = avatarResult.value
        loaded = userResult.status === 'fulfilled' && avatarResult.status === 'fulfilled'
      })
      .finally(() => { if (source === generation && pending === request) pending = null })
    pending = request
    return request
  }

  return { username, avatar, profileAvatar, loadAccount, onAccountDisposed }
})
