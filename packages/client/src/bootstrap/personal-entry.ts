import { createApp, h, ref } from 'vue'
import { NConfigProvider, darkTheme } from 'naive-ui'
import { createClientExtensionRegistry } from '@/modules/studio-extensions/registry'
import { createRouter, createWebHashHistory } from 'vue-router'
import { personalAgentClientExtension } from '@/modules/studio-extensions/personal-agent'
import { observeModuleEvents } from './extension-events'
import '@/styles/global.scss'

declare global { interface Window { personalGateway?: { chooseWorkspace(label: string, capabilities: string[]): Promise<unknown> } } }
async function start() {
  const router = createRouter({ history: createWebHashHistory(), routes: [] })
  const locale = ref(localStorage.getItem('personal_locale') || 'zh-TW')
  const theme = ref(localStorage.getItem('personal_theme') || 'light')
  const registry = createClientExtensionRegistry(router, {
    async request<T>(path: string, options?: RequestInit): Promise<T> {
      if (!path.startsWith('/api/studio/')) throw new Error('INVALID_REQUEST')
      const response = await fetch(path, { ...options, redirect: 'error', headers: { 'Content-Type': 'application/json', ...options?.headers } })
      const value = await response.json()
      if (!response.ok) throw new Error(value?.error?.code || 'UNAVAILABLE')
      return value as T
    },
    hasSession: () => true, managedUsers: async () => ({ users: [] }), onAuthInvalidated: () => () => {}, locale, theme,
    ...{ chooseWorkspace: window.personalGateway?.chooseWorkspace, stream: observeModuleEvents },
  }, [personalAgentClientExtension])
  await registry.ensure()
  if (!router.hasRoute('studio.personalAgent')) throw new Error('MODULE_UNAVAILABLE')
  await router.replace('/personal-agent'); await router.isReady()
  const { default: PersonalAgentView } = await import('@/modules/studio-extensions/personal-agent/PersonalAgentView.vue')
  createApp({ render: () => h(NConfigProvider, { theme: theme.value === 'dark' ? darkTheme : null }, { default: () => h(PersonalAgentView, { standalone: true }) }) }).use(router).mount('#app')
}
void start().catch(() => { const app = document.getElementById('app'); if (app) app.textContent = 'PERSONAL_MODULE_UNAVAILABLE' })
