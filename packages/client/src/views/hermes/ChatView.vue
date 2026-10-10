<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue'
import PageLoading from '@/components/common/PageLoading.vue'
import { useRoute } from 'vue-router'
import ChatPanel from '@/components/hermes/chat/ChatPanel.vue'
import { useChatStore } from '@/stores/hermes/chat'
import { useChatRouteInitialization } from '@/composables/useChatRouteInitialization'

const chatStore = useChatStore()
const route = useRoute()


const isStandaloneChat = computed(() => route.meta?.standaloneChat === true)
type ChatContentMode = 'chat' | 'connections' | 'agents' | 'models'

const contentMode = computed<ChatContentMode>(() => {
  if (route.name === 'hermes.connections') return 'connections'
  if (route.name === 'hermes.agentManager') return 'agents'
  if (route.name === 'hermes.models') return 'models'
  return 'chat'
})
const productTitle = 'Ekko Studio'
const { pageLoading, initializationError, loadChatRoute } = useChatRouteInitialization(contentMode)
const tabTitle = computed(() => {
  if (route.name !== 'hermes.session' && route.name !== 'desktop.chat') return productTitle
  return chatStore.activeSession?.title?.trim() || productTitle
})

watch(tabTitle, (value) => {
  document.title = value
}, { immediate: true })

onUnmounted(() => { document.title = productTitle })
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
