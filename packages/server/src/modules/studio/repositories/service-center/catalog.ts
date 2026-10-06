import { chmod, mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { config } from '../../public/config'
import { safeFileStore } from '../../public/safe-file-store'
import { ServiceCenterError, validateManifest, validateService, type ServiceEntry, type ServiceManifest } from '../../contracts/service-center/manifest'

const root = join(config.appHome, 'service-center')
const catalogPath = join(root, 'catalog.json')
const grantPath = join(root, 'editors.json')
const approvalPath = join(root, 'health-approvals.json')
const favoritesPath = (id: number) => join(root, 'favorites', `${id}.json`)
const emptyCatalog = (): Catalog => ({ revision: 0, schemaVersion: 1, services: [] })
export interface Catalog extends ServiceManifest { revision: number }
interface Grants { editorIds: number[]; audit: Array<{ actorId: number; targetId: number; action: 'grant' | 'revoke'; at: string }> }

async function setup(): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  await chmod(root, 0o700)
}
async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
function parseCatalog(raw: unknown): Catalog {
  if (raw === undefined) return emptyCatalog()
  if (!raw || typeof raw !== 'object' || !Number.isSafeInteger((raw as Catalog).revision) || (raw as Catalog).revision < 0) throw new Error('Invalid catalog state')
  if (Object.keys(raw).some(key => !['revision', 'schemaVersion', 'services'].includes(key))) throw new Error('Invalid catalog state')
  return { ...validateManifest({ schemaVersion: (raw as Catalog).schemaVersion, services: (raw as Catalog).services }), revision: (raw as Catalog).revision }
}
function parseGrants(raw: unknown): Grants {
  if (raw === undefined) return { editorIds: [], audit: [] }
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Grants).editorIds) || !Array.isArray((raw as Grants).audit) ||
    !(raw as Grants).editorIds.every(id => Number.isSafeInteger(id) && id > 0)) throw new Error('Invalid editor state')
  return raw as Grants
}
function parseApprovals(raw: unknown): Record<string, string> {
  if (raw === undefined) return {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
    !Object.values(raw).every(value => typeof value === 'string')) throw new Error('Invalid health approvals')
  return raw as Record<string, string>
}
async function update<T>(path: string, change: (raw: unknown) => { value: unknown; result: T }): Promise<T> {
  await setup()
  const result = await safeFileStore.updateText<T>(path, text => {
    const { value, result } = change(text ? JSON.parse(text) : undefined)
    return { content: JSON.stringify(value), result }
  }, { mode: 0o600 })
  await chmod(path, 0o600)
  return result as T
}
export async function catalog(): Promise<Catalog> { return parseCatalog(await readJson(catalogPath)) }
export async function mutateCatalog(expectedRevision: number, change: (current: Catalog) => ServiceEntry[]): Promise<Catalog> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new ServiceCenterError('Expected revision required', 400)
  await setup()
  const result = await safeFileStore.updateTexts<Catalog>([catalogPath, approvalPath], raw => {
    const current = parseCatalog(raw[catalogPath] ? JSON.parse(raw[catalogPath]) : undefined)
    if (expectedRevision !== current.revision) throw new ServiceCenterError('Catalog changed; reload before saving', 409)
    if (!Number.isSafeInteger(current.revision + 1)) throw new ServiceCenterError('Revision limit reached', 409)
    const manifest = validateManifest({ schemaVersion: 1, services: change(current) })
    const next: Catalog = { ...manifest, revision: current.revision + 1 }
    const approvals = { ...parseApprovals(raw[approvalPath] ? JSON.parse(raw[approvalPath]) : undefined) }
    for (const [id, approvedUrl] of Object.entries(approvals)) {
      if (current.services.find(service => service.id === id)?.healthUrl === approvedUrl &&
        next.services.find(service => service.id === id)?.healthUrl === approvedUrl) continue
      delete approvals[id]
    }
    return { files: { [catalogPath]: JSON.stringify(next),
      ...(Object.keys(approvals).length !== Object.keys(parseApprovals(raw[approvalPath] ? JSON.parse(raw[approvalPath]) : undefined)).length
        ? { [approvalPath]: JSON.stringify(approvals) } : {}),
    }, result: next }
  }, { backup: false, mode: 0o600 })
  await chmod(catalogPath, 0o600)
  if (result && await readJson(approvalPath) !== undefined) await chmod(approvalPath, 0o600)
  return result!
}
export async function saveService(expectedRevision: number, input: unknown): Promise<Catalog> {
  const service = validateService(input)
  return mutateCatalog(expectedRevision, current => {
    const services = current.services.filter(item => item.id !== service.id)
    return [...services, service]
  })
}
export async function deleteService(expectedRevision: number, id: string): Promise<Catalog> {
  return mutateCatalog(expectedRevision, current => {
    if (!current.services.some(item => item.id === id)) throw new ServiceCenterError('Service not found', 404)
    return current.services.filter(item => item.id !== id)
  })
}
export function previewImport(current: Catalog, input: unknown) {
  const manifest = validateManifest(input)
  const existing = new Map(current.services.map(service => [service.id, service]))
  return { revision: current.revision, count: manifest.services.length,
    newIds: manifest.services.filter(service => !existing.has(service.id)).map(service => service.id),
    conflicts: manifest.services.filter(service => existing.has(service.id)).map(service => ({ id: service.id, current: existing.get(service.id), incoming: service })),
  }
}
export async function importManifest(expectedRevision: number, input: unknown, choices: unknown): Promise<Catalog> {
  const manifest = validateManifest(input)
  if (!choices || typeof choices !== 'object' || Array.isArray(choices)) throw new ServiceCenterError('Conflict choices required')
  return mutateCatalog(expectedRevision, current => {
    const byId = new Map(current.services.map(service => [service.id, service]))
    const conflictIds = manifest.services.filter(service => byId.has(service.id)).map(service => service.id)
    const selection = choices as Record<string, unknown>
    if (Object.keys(selection).some(id => !conflictIds.includes(id)) ||
      conflictIds.some(id => !['keep', 'overwrite'].includes(selection[id] as string))) throw new ServiceCenterError('Select keep or overwrite for every conflict')
    for (const service of manifest.services) if (!byId.has(service.id) || selection[service.id] === 'overwrite') byId.set(service.id, service)
    return [...byId.values()]
  })
}
export async function isEditor(id: number): Promise<boolean> {
  return parseGrants(await readJson(grantPath)).editorIds.includes(id)
}
export async function listEditors(): Promise<number[]> { return parseGrants(await readJson(grantPath)).editorIds }
export async function setEditor(actorId: number, targetId: number, granted: boolean): Promise<number[]> {
  return update(grantPath, raw => {
    const current = parseGrants(raw)
    const ids = new Set(current.editorIds)
    if (granted) ids.add(targetId)
    else ids.delete(targetId)
    const next: Grants = { editorIds: [...ids], audit: [...current.audit, {
      actorId, targetId, action: granted ? 'grant' as const : 'revoke' as const, at: new Date().toISOString(),
    }].slice(-500) }
    return { value: next, result: next.editorIds }
  })
}
export async function getFavorites(userId: number): Promise<string[]> {
  const raw = await readJson(favoritesPath(userId))
  if (raw === undefined) return []
  if (!Array.isArray(raw) || !raw.every(value => typeof value === 'string')) throw new Error('Invalid favorites state')
  return raw
}
export async function setFavorite(userId: number, id: string, favorite: boolean): Promise<string[]> {
  const path = favoritesPath(userId)
  await setup()
  await mkdir(join(root, 'favorites'), { recursive: true, mode: 0o700 })
  await chmod(join(root, 'favorites'), 0o700)
  return update(path, raw => {
    const current = raw === undefined ? [] : raw
    if (!Array.isArray(current) || !current.every(value => typeof value === 'string')) throw new Error('Invalid favorites state')
    const ids = new Set(current)
    if (favorite) ids.add(id)
    else ids.delete(id)
    const next = [...ids]
    return { value: next, result: next }
  })
}
export async function isHealthApproved(id: string, url: string): Promise<boolean> {
  return parseApprovals(await readJson(approvalPath))[id] === url
}
export async function approveHealth(id: string, url: string, approved: boolean): Promise<void> {
  await setup()
  await safeFileStore.updateTexts([catalogPath, approvalPath], raw => {
    const snapshot = parseCatalog(raw[catalogPath] ? JSON.parse(raw[catalogPath]) : undefined)
    if (snapshot.services.find(service => service.id === id)?.healthUrl !== url) throw new ServiceCenterError('Health URL changed; reload', 409)
    const next = { ...parseApprovals(raw[approvalPath] ? JSON.parse(raw[approvalPath]) : undefined) }
    if (approved) next[id] = url
    else delete next[id]
    return { [approvalPath]: JSON.stringify(next) }
  }, { backup: false, mode: 0o600 })
  await chmod(approvalPath, 0o600)
}
