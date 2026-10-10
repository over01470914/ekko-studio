import type { RouteLocationNormalized } from 'vue-router'
// Only the default landing after startup/login may offer a mode. Explicit deep links remain authoritative.
export function offerExtensionEntry(to: Pick<RouteLocationNormalized, 'fullPath' | 'redirectedFrom'>, from: Pick<RouteLocationNormalized, 'name'>, available: boolean, preference: string | null) {
  return available && !preference && to.fullPath === '/hermes/chat' && (to.redirectedFrom?.path === '/' || from.name === 'login')
}
