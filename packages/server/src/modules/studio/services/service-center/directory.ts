import { findUserById } from '../../repositories/users-store'
import { ServiceCenterError } from '../../contracts/service-center/manifest'
import * as registry from '../../repositories/service-center/catalog'
import { healthFor, resolveHealthTarget } from './health'

function activeUser(id: unknown) {
  const user = typeof id === 'number' && Number.isSafeInteger(id) ? findUserById(id) : null
  if (!user || user.status !== 'active') throw new ServiceCenterError('Active user required', 403)
  return user
}

async function capabilities(id: unknown) {
  const user = activeUser(id)
  const canManageEditors = user.role === 'super_admin'
  return { canManageEditors, canManageServices: canManageEditors || (user.role === 'admin' && await registry.isEditor(user.id)) }
}

async function requireEditor(id: unknown) {
  if (!(await capabilities(id)).canManageServices) throw new ServiceCenterError('Service Center editor required', 403)
}

function requireSuperAdmin(id: unknown) {
  if (activeUser(id).role !== 'super_admin') throw new ServiceCenterError('Super administrator required', 403)
}

export async function catalogFor(id: unknown) {
  const user = activeUser(id)
  const rights = await capabilities(id)
  const snapshot = await registry.catalog()
  const services = rights.canManageServices ? snapshot.services : snapshot.services.filter(service => service.enabled)
  const favorites = await registry.getFavorites(user.id)
  const health = Object.fromEntries(await Promise.all(services.map(async service => [service.id, await healthFor(service)] as const)))
  return { revision: snapshot.revision, services, favorites: favorites.filter(key => services.some(service => service.id === key)), health, capabilities: rights }
}

export async function manifestFor(id: unknown) {
  const rights = await capabilities(id)
  const snapshot = await registry.catalog()
  return { schemaVersion: 1, services: rights.canManageServices ? snapshot.services : snapshot.services.filter(service => service.enabled) }
}

export async function saveService(id: unknown, revision: unknown, service: unknown) {
  await requireEditor(id)
  return registry.saveService(revision as number, service)
}

export async function deleteService(id: unknown, revision: unknown, serviceId: string) {
  await requireEditor(id)
  return registry.deleteService(revision as number, serviceId)
}

export async function previewImport(id: unknown, manifest: unknown) {
  await requireEditor(id)
  return registry.previewImport(await registry.catalog(), manifest)
}

export async function confirmImport(id: unknown, revision: unknown, manifest: unknown, conflicts: unknown) {
  await requireEditor(id)
  return registry.importManifest(revision as number, manifest, conflicts)
}

export async function setFavorite(id: unknown, serviceId: string, favorite: unknown) {
  const user = activeUser(id)
  if (typeof favorite !== 'boolean') throw new ServiceCenterError('favorite must be boolean')
  const service = (await registry.catalog()).services.find(item => item.id === serviceId && item.enabled)
  if (!service) throw new ServiceCenterError('Service not found', 404)
  return { favorites: await registry.setFavorite(user.id, service.id, favorite) }
}

export async function checkHealth(id: unknown, serviceId: string) {
  const rights = await capabilities(id)
  const service = (await registry.catalog()).services.find(item => item.id === serviceId && (item.enabled || rights.canManageServices))
  if (!service) throw new ServiceCenterError('Service not found', 404)
  return healthFor(service, true)
}

export async function approveHealth(id: unknown, serviceId: string, approved: unknown) {
  await requireEditor(id)
  if (typeof approved !== 'boolean') throw new ServiceCenterError('approved must be boolean')
  const service = (await registry.catalog()).services.find(item => item.id === serviceId)
  if (!service?.healthUrl) throw new ServiceCenterError('Health URL not found', 404)
  if (approved) await resolveHealthTarget(service.healthUrl)
  await registry.approveHealth(service.id, service.healthUrl, approved)
  return { approved }
}

export async function listEditors(id: unknown) {
  requireSuperAdmin(id)
  return { editorIds: await registry.listEditors() }
}

export async function changeEditor(id: unknown, targetId: number, granted: unknown) {
  const actor = activeUser(id)
  requireSuperAdmin(id)
  if (!Number.isSafeInteger(targetId) || targetId <= 0 || typeof granted !== 'boolean') throw new ServiceCenterError('Invalid editor selection')
  const target = findUserById(targetId)
  if (!target || target.role !== 'admin' || target.status !== 'active') throw new ServiceCenterError('Active admin not found', 404)
  return { editorIds: await registry.setEditor(actor.id, targetId, granted) }
}