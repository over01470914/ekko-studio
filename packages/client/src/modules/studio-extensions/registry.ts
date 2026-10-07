import { shallowRef, type Ref } from 'vue'
import type { RouteRecordRaw, Router } from 'vue-router'

export interface ExtensionDescription { id: string; version: string; apiBase: string; capabilities: string[] }
export interface ExtensionNavigation { key: string; route: string; label: string; path: string }
export const extensionNavigation = shallowRef<ExtensionNavigation[]>([])
export interface ClientExtensionHost {
  request<T>(path: string, options?: RequestInit): Promise<T>
  managedUsers(): Promise<{ users: Array<{ id: number; username: string; role: string; status: string }> }>
  hasSession(): boolean
  onAuthInvalidated(listener: () => void): () => void
  locale: Readonly<Ref<string>>
  theme: Readonly<Ref<string>>
}
export interface ClientExtensionSpec {
  id: string
  version: string
  capabilities: string[]
  initialize(host: ClientExtensionHost): { route: RouteRecordRaw; navigation: (locale: string) => ExtensionNavigation; dispose: () => void }
}
interface Discovery { contractVersion: number; extensions: ExtensionDescription[] }

// Only server-advertised, locally allowlisted modules may contribute a route or navigation.
export function createClientExtensionRegistry(router: Router, host: ClientExtensionHost, specs: ClientExtensionSpec[]) {
  const active: Array<{ name: string; navigation: (locale: string) => ExtensionNavigation; dispose: () => void }> = []
  let sequence = 0
  let loaded = false
  let pending: Promise<void> | null = null
  function reset() {
    sequence++
    loaded = false
    for (const item of active.splice(0).reverse()) {
      router.removeRoute(item.name)
      item.dispose()
    }
    extensionNavigation.value = []
    pending = null
  }
  const stop = host.onAuthInvalidated(reset)
  async function ensure(): Promise<void> {
    if (!host.hasSession() || loaded) return
    if (pending) return pending
    const current = sequence
    const run = async () => {
      try {
        const response = await host.request<Discovery>('/api/studio/extensions')
        if (current !== sequence || !host.hasSession()) return
        if (!response || response.contractVersion !== 1 || !Array.isArray(response.extensions)) throw new Error('Invalid Studio extension discovery')
        const found = new Set<string>()
        for (const descriptor of response.extensions) {
          if (!descriptor || typeof descriptor.id !== 'string' || found.has(descriptor.id)) throw new Error('Duplicate or invalid Studio extension')
          found.add(descriptor.id)
        }
        for (const spec of specs) {
          const descriptor = response.extensions.find(item => item.id === spec.id)
          if (!descriptor || descriptor.version !== spec.version || descriptor.apiBase !== `/api/studio/${spec.id}` ||
            !Array.isArray(descriptor.capabilities) || !spec.capabilities.every(capability => descriptor.capabilities.includes(capability))) continue
          let installed: ReturnType<ClientExtensionSpec['initialize']> | null = null
          try {
            installed = spec.initialize(host)
            if (installed.route.path !== `/${spec.id}` || typeof installed.route.name !== 'string' ||
              !installed.route.name.startsWith('studio.') || router.hasRoute(installed.route.name) ||
              router.getRoutes().some(route => route.path === installed?.route.path)) {
              throw new Error('Invalid or colliding Studio extension route')
            }
            router.addRoute(installed.route)
            active.push({ name: installed.route.name, navigation: installed.navigation, dispose: installed.dispose })
          } catch {
            installed?.dispose()
            console.error('Studio extension failed to register:', spec.id)
          }
        }
        if (current === sequence) {
          loaded = true
          refreshNavigation()
        }
      } catch {
        if (current === sequence) { reset(); console.error('Studio extension discovery unavailable') }
      }
    }
    pending = run().finally(() => { if (current === sequence) pending = null })
    return pending
  }
  function refreshNavigation() {
    extensionNavigation.value = active.map(item => item.navigation(host.locale.value))
  }
  function dispose() { stop(); reset() }
  return { ensure, reset, dispose, refreshNavigation }
}
