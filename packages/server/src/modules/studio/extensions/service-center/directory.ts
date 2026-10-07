import { ServiceCenterError } from './manifest'
import * as registry from './catalog'
import { healthFor, resolveHealthTarget } from './health'
import { serviceCenterHost, type ServiceCenterActor } from './host'

async function capabilities(actor: ServiceCenterActor) {
  const canManageEditors = actor.role === 'super_admin'
  return { canManageEditors, canManageServices: canManageEditors || (actor.role === 'admin' && await registry.isEditor(actor.id)) }
}

async function requireEditor(actor: ServiceCenterActor) {
  if (!(await capabilities(actor)).canManageServices) throw new ServiceCenterError('Service Center editor required', 403)
}

function requireSuperAdmin(actor: ServiceCenterActor) {
  if (actor.role !== 'super_admin') throw new ServiceCenterError('Super administrator required', 403)
}

export async function catalogFor(actor: ServiceCenterActor) {
  const rights = await capabilities(actor)
  const snapshot = await registry.catalog()
  const services = rights.canManageServices ? snapshot.services : snapshot.services.filter(service => service.enabled)
  const favorites = await registry.getFavorites(actor.id)
  const health = Object.fromEntries(await Promise.all(services.map(async service => [service.id, await healthFor(service)] as const)))
  return { revision: snapshot.revision, services, favorites: favorites.filter(key => services.some(service => service.id === key)), health, capabilities: rights }
}

export async function manifestFor(actor: ServiceCenterActor) {
  const rights = await capabilities(actor)
  const snapshot = await registry.catalog()
  return { schemaVersion: 1, services: rights.canManageServices ? snapshot.services : snapshot.services.filter(service => service.enabled) }
}

export async function saveService(actor: ServiceCenterActor, revision: unknown, service: unknown) {
  await requireEditor(actor)
  return registry.saveService(revision as number, service)
}

export async function deleteService(actor: ServiceCenterActor, revision: unknown, serviceId: string) {
  await requireEditor(actor)
  return registry.deleteService(revision as number, serviceId)
}

export async function previewImport(actor: ServiceCenterActor, manifest: unknown) {
  await requireEditor(actor)
  return registry.previewImport(await registry.catalog(), manifest)
}

export async function confirmImport(actor: ServiceCenterActor, revision: unknown, manifest: unknown, conflicts: unknown) {
  await requireEditor(actor)
  return registry.importManifest(revision as number, manifest, conflicts)
}

export async function setFavorite(actor: ServiceCenterActor, serviceId: string, favorite: unknown) {
  if (typeof favorite !== 'boolean') throw new ServiceCenterError('favorite must be boolean')
  const service = (await registry.catalog()).services.find(item => item.id === serviceId && item.enabled)
  if (!service) throw new ServiceCenterError('Service not found', 404)
  return { favorites: await registry.setFavorite(actor.id, service.id, favorite) }
}

export async function checkHealth(actor: ServiceCenterActor, serviceId: string) {
  const rights = await capabilities(actor)
  const service = (await registry.catalog()).services.find(item => item.id === serviceId && (item.enabled || rights.canManageServices))
  if (!service) throw new ServiceCenterError('Service not found', 404)
  return healthFor(service, true)
}

export async function approveHealth(actor: ServiceCenterActor, serviceId: string, approved: unknown) {
  await requireEditor(actor)
  if (typeof approved !== 'boolean') throw new ServiceCenterError('approved must be boolean')
  const service = (await registry.catalog()).services.find(item => item.id === serviceId)
  if (!service?.healthUrl) throw new ServiceCenterError('Health URL not found', 404)
  if (approved) await resolveHealthTarget(service.healthUrl)
  await registry.approveHealth(service.id, service.healthUrl, approved)
  return { approved }
}

export async function listEditors(actor: ServiceCenterActor) {
  requireSuperAdmin(actor)
  return { editorIds: await registry.listEditors() }
}

export async function changeEditor(actor: ServiceCenterActor, targetId: number, granted: unknown) {
  requireSuperAdmin(actor)
  if (!Number.isSafeInteger(targetId) || targetId <= 0 || typeof granted !== 'boolean') throw new ServiceCenterError('Invalid editor selection')
  if (!serviceCenterHost().eligibleAdmin(targetId)) throw new ServiceCenterError('Active admin not found', 404)
  return { editorIds: await registry.setEditor(actor.id, targetId, granted) }
}