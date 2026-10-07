import type { Context } from 'koa'

// Contract v1: the module never reads Studio's user repository, tokens or config.
export interface ServiceCenterActor { id: number; role: 'admin' | 'super_admin' }
export interface ServiceCenterHost {
  readonly dataRoot: string
  actorFor(ctx: Context): ServiceCenterActor
  eligibleAdmin(id: number): boolean
}

let activeHost: ServiceCenterHost | null = null
export function installServiceCenterHost(host: ServiceCenterHost): () => void {
  if (activeHost) throw new Error('Service Center host already installed')
  activeHost = host
  return () => { if (activeHost === host) activeHost = null }
}
export function serviceCenterHost(): ServiceCenterHost {
  if (!activeHost) throw new Error('Service Center host unavailable')
  return activeHost
}
