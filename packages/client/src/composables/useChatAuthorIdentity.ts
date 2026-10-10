import { reactive } from 'vue'
import { onAuthInvalidated } from '@/api/auth-invalidation'
import { useAccountStore } from '@/stores/account'
import { useChatStore, type Message } from '@/stores/hermes/chat'

const registries = new WeakMap<ReturnType<typeof useChatStore>, Map<string, true>>()
const MAX_PROVEN_MESSAGES = 256

function key(sessionId: string, messageId: string): string {
  return JSON.stringify([sessionId, messageId])
}

export function useChatAuthorIdentity() {
  const chat = useChatStore()
  const account = useAccountStore()
  let registry = registries.get(chat)
  if (!registry) {
    const ids = reactive(new Map<string, true>())
    const stopAuth = onAuthInvalidated(() => ids.clear())
    const stopPublication = chat.onLocalUserMessage((sessionId, messageId) => {
      ids.set(key(sessionId, messageId), true)
      if (ids.size > MAX_PROVEN_MESSAGES) ids.delete(ids.keys().next().value!)
    })
    registry = ids
    registries.set(chat, registry)
    account.onAccountDisposed(() => {
      stopPublication()
      stopAuth()
      ids.clear()
      registries.delete(chat)
    })
  }
  const current = registry
  void account.loadAccount()
  return {
    account,
    isLocalAuthor: (sessionId: string | undefined, message: Message) =>
      !!sessionId && (message.role === 'user' || message.role === 'command') &&
      current.has(key(sessionId, message.id)),
  }
}
