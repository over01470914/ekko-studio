import { watch, type Ref } from 'vue'
import type { Router } from 'vue-router'
import { hasApiKey, request, getApiKey } from '@/api/client'
import { onAuthInvalidated } from '@/api/auth-invalidation'
import { createClientExtensionRegistry } from '@/modules/studio-extensions/registry'
import { serviceCenterClientExtension } from '@/modules/studio-extensions/service-center'
import { personalAgentClientExtension } from '@/modules/studio-extensions/personal-agent'
import { observeModuleEvents } from './extension-events'
import { offerExtensionEntry } from './extension-entry'

// Only the host adapter knows Studio's authentication, user API and global signals.
export function registerStudioExtensions(router: Router, locale: Readonly<Ref<string>>, theme: Readonly<Ref<string>>) {
  const registry = createClientExtensionRegistry(router, {
    request,
    managedUsers: () => request('/api/auth/users'),
    hasSession: hasApiKey,
    onAuthInvalidated,
    locale,
    theme,
    ...{ openWorkbench: () => router.push('/hermes/chat'), stream: (path: string, listener: (event: unknown) => void, after: number) => observeModuleEvents(path, listener, after, getApiKey) },
  }, [serviceCenterClientExtension, personalAgentClientExtension])
  watch(locale, registry.refreshNavigation)
  router.beforeEach(async (to, from) => {
    await registry.ensure()
    // The first resolution of a deep link may predate asynchronous route registration.
    if (!to.matched.length && router.resolve(to.fullPath).matched.length) return to.fullPath
    if (offerExtensionEntry(to, from, router.hasRoute('studio.personalAgent'), localStorage.getItem('studio_entry_mode'))) return '/personal-agent'
  })
  return registry
}
