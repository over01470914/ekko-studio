import { watch, type Ref } from 'vue'
import type { Router } from 'vue-router'
import { hasApiKey, request } from '@/api/client'
import { onAuthInvalidated } from '@/api/auth-invalidation'
import { createClientExtensionRegistry } from '@/modules/studio-extensions/registry'
import { serviceCenterClientExtension } from '@/modules/studio-extensions/service-center'

// Only the host adapter knows Studio's authentication, user API and global signals.
export function registerStudioExtensions(router: Router, locale: Readonly<Ref<string>>, theme: Readonly<Ref<string>>) {
  const registry = createClientExtensionRegistry(router, {
    request,
    managedUsers: () => request('/api/auth/users'),
    hasSession: hasApiKey,
    onAuthInvalidated,
    locale,
    theme,
  }, [serviceCenterClientExtension])
  watch(locale, registry.refreshNavigation)
  router.beforeEach(async to => {
    await registry.ensure()
    // The first resolution of a deep link may predate asynchronous route registration.
    if (!to.matched.length && router.resolve(to.fullPath).matched.length) return to.fullPath
  })
  return registry
}
