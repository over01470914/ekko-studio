import type { Ref } from 'vue'

export interface ServiceCenterClientHost {
  request<T>(path: string, options?: RequestInit): Promise<T>
  managedUsers(): Promise<{ users: Array<{ id: number; username: string; role: string; status: string }> }>
  onAuthInvalidated(listener: () => void): () => void
  locale: Readonly<Ref<string>>
  theme: Readonly<Ref<string>>
}
let active: ServiceCenterClientHost | null = null
const resets = new Set<() => void>()
export const onServiceCenterReset = (listener: () => void): (() => void) => {
  resets.add(listener)
  return () => { resets.delete(listener) }
}
export function installServiceCenterClientHost(host: ServiceCenterClientHost): () => void {
  if (active) throw new Error('Service Center client already installed')
  active = host
  return () => {
    if (active !== host) return
    for (const reset of [...resets]) reset()
    active = null
  }
}
export function serviceCenterClientHost(): ServiceCenterClientHost {
  if (!active) throw new Error('Service Center is not available')
  return active
}
