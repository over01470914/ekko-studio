import { readFile } from 'fs/promises'

import { ServiceCenterError, validateManifest, validateService, validateCategory, validateNode, normalizeLegacy, categoryNameKey, type Category, type DeploymentNode, type ServiceEntry, type ServiceManifest } from './manifest'
import { dataPath, updateFiles } from './storage'

const catalogPath = () => dataPath('catalog.json')
const grantPath = () => dataPath('editors.json')
const approvalPath = () => dataPath('health-approvals.json')
const favoritesPath = (id: number) => dataPath('favorites', `${id}.json`)
const emptyCatalog = (): Catalog => ({ revision: 0, schemaVersion: 2,
  categories: [{ id: 'private-services', name: '私有服務', sortOrder: 0 }, { id: 'public-services', name: '公網服務', sortOrder: 1 }], nodes: [], services: [] })
const backupPath = () => dataPath('catalog-v1.backup.json')
export interface Catalog extends ServiceManifest { revision: number }
interface Grants { editorIds: number[]; audit: Array<{ actorId: number; targetId: number; action: 'grant' | 'revoke'; at: string }> }


async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
function parseCatalog(raw: unknown): Catalog {
  if (raw === undefined) return emptyCatalog()
  if (!raw || typeof raw !== 'object' || !Number.isSafeInteger((raw as Catalog).revision) || (raw as Catalog).revision < 0) throw new Error('Invalid catalog state')
  const { revision, ...manifest } = raw as Catalog
  if ((raw as { schemaVersion?: unknown }).schemaVersion === 1) {
    if (Object.keys(raw).some(key => !['revision', 'schemaVersion', 'services'].includes(key))) throw new Error('Invalid catalog state')
    return { ...normalizeLegacy(manifest), revision }
  }
  return { ...validateManifest(manifest), revision }
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
  return updateFiles([path], raw => {
    const { value, result } = change(raw[path] ? JSON.parse(raw[path]) : undefined)
    return { files: { [path]: JSON.stringify(value) }, result }
  })
}
export async function catalog(): Promise<Catalog> { return parseCatalog(await readJson(catalogPath())) }
export async function mutateCatalog(expectedRevision: number, change: (current: Catalog) => ServiceManifest): Promise<Catalog> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new ServiceCenterError('Expected revision required', 400)
  const catalogFile = catalogPath()
  const approvalFile = approvalPath()
  const backupFile = backupPath()
  return updateFiles([backupFile, catalogFile, approvalFile], raw => {
    const current = parseCatalog(raw[catalogFile] ? JSON.parse(raw[catalogFile]) : undefined)
    if (expectedRevision !== current.revision) throw new ServiceCenterError('Catalog changed; reload before saving', 409)
    if (!Number.isSafeInteger(current.revision + 1)) throw new ServiceCenterError('Revision limit reached', 409)
    const manifest = validateManifest(change(current))
    const next: Catalog = { ...manifest, revision: current.revision + 1 }
    const approvals = { ...parseApprovals(raw[approvalFile] ? JSON.parse(raw[approvalFile]) : undefined) }
    for (const [id, approvedUrl] of Object.entries(approvals)) {
      if (current.services.find(service => service.id === id)?.healthUrl === approvedUrl &&
        next.services.find(service => service.id === id)?.healthUrl === approvedUrl) continue
      delete approvals[id]
    }
    const legacy = raw[catalogFile] !== undefined && JSON.parse(raw[catalogFile]).schemaVersion === 1
    if (legacy && raw[backupFile] !== undefined && raw[backupFile] !== raw[catalogFile]) throw new ServiceCenterError('Legacy backup mismatch; restore or inspect before upgrading', 409)
    return { files: { ...(legacy && raw[backupFile] === undefined ? { [backupFile]: raw[catalogFile] } : {}), [catalogFile]: JSON.stringify(next),
      ...(Object.keys(approvals).length !== Object.keys(parseApprovals(raw[approvalFile] ? JSON.parse(raw[approvalFile]) : undefined)).length
        ? { [approvalFile]: JSON.stringify(approvals) } : {}),
    }, result: next }
  })
}
export async function saveService(expectedRevision: number, input: unknown): Promise<Catalog> {
  const service = validateService(input)
  return mutateCatalog(expectedRevision, current => {
    const services = current.services.filter(item => item.id !== service.id)
    return { schemaVersion: 2, categories: current.categories, nodes: current.nodes, services: [...services, service] }
  })
}
export async function deleteService(expectedRevision: number, id: string): Promise<Catalog> {
  return mutateCatalog(expectedRevision, current => {
    if (!current.services.some(item => item.id === id)) throw new ServiceCenterError('Service not found', 404)
    return { schemaVersion: 2, categories: current.categories, nodes: current.nodes, services: current.services.filter(item => item.id !== id) }
  })
}
type OrganizationKind = 'categories' | 'nodes'
export async function saveOrganization(expectedRevision: number, kind: OrganizationKind, input: unknown): Promise<Catalog> {
  const item = kind === 'categories' ? validateCategory(input) : validateNode(input)
  return mutateCatalog(expectedRevision, current => ({ schemaVersion: 2, categories: current.categories, nodes: current.nodes, services: current.services,
    [kind]: [...current[kind].filter(entry => entry.id !== item.id), item] }))
}
export async function deleteOrganization(expectedRevision: number, kind: OrganizationKind, id: string, replacement: unknown): Promise<Catalog> {
  if (replacement !== null && (typeof replacement !== 'string' || !replacement)) throw new ServiceCenterError('Explicit reassignment required')
  const field = kind === 'categories' ? 'categoryId' : 'nodeId'
  return mutateCatalog(expectedRevision, current => {
    if (!current[kind].some(entry => entry.id === id)) throw new ServiceCenterError('Organization not found', 404)
    if (replacement === id || (replacement !== null && !current[kind].some(entry => entry.id === replacement))) throw new ServiceCenterError('Invalid reassignment target')
    return { schemaVersion: 2, categories: current.categories, nodes: current.nodes, [kind]: current[kind].filter(entry => entry.id !== id),
      services: current.services.map(service => service[field] === id ? { ...service, [field]: replacement } : service) }
  })
}
const incomingFor = (current: Catalog, input: unknown): ServiceManifest => {
  if (input && typeof input === 'object' && (input as { schemaVersion?: unknown }).schemaVersion === 1) {
    const normalized = normalizeLegacy(input, current.categories)
    return { ...normalized, categories: normalized.categories.filter(item => !current.categories.some(existing => existing.id === item.id)) }
  }
  // A v2 import may reference an existing category/node without re-declaring
  // it. Validate the document's own records first, then resolve references
  // against the effective merged collections before showing a preview.
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['schemaVersion', 'categories', 'nodes', 'services'].includes(key)) ||
    (input as { schemaVersion?: unknown }).schemaVersion !== 2 || !Array.isArray((input as ServiceManifest).categories) ||
    !Array.isArray((input as ServiceManifest).nodes) || !Array.isArray((input as ServiceManifest).services)) throw new ServiceCenterError('Invalid import manifest')
  const document = input as ServiceManifest
  const incoming = validateManifest({ ...document, services: document.services.map(raw => {
    const item = validateService(raw)
    return { ...item, categoryId: null, nodeId: null }
  }) })
  validateManifest({ schemaVersion: 2, categories: [...current.categories.filter(item => !incoming.categories.some(next => next.id === item.id)), ...incoming.categories],
    nodes: [...current.nodes.filter(item => !incoming.nodes.some(next => next.id === item.id)), ...incoming.nodes], services: document.services })
  return { ...incoming, services: document.services }
}
function importPlan(current: Catalog, input: unknown) {
  const incoming = incomingFor(current, input)
  const conflicts: Array<{ key: string; entity: OrganizationKind | 'services'; id: string; current: Category | DeploymentNode | ServiceEntry; incoming: Category | DeploymentNode | ServiceEntry }> = []
  const newIds: Record<'categories' | 'nodes' | 'services', string[]> = { categories: [], nodes: [], services: [] }
  for (const kind of ['categories', 'nodes', 'services'] as const) {
    for (const item of incoming[kind]) {
      const previous = current[kind].find(entry => entry.id === item.id)
      if (previous) conflicts.push({ key: `${kind}:${item.id}`, entity: kind, id: item.id, current: previous, incoming: item })
      else newIds[kind].push(item.id)
    }
  }
  for (const kind of ['categories', 'nodes'] as const) for (const item of incoming[kind]) {
    const nameKey = kind === 'categories' ? categoryNameKey : (name: string) => name.normalize('NFKC').toLowerCase()
    if (current[kind].some(previous => previous.id !== item.id && nameKey(previous.name) === nameKey(item.name))) throw new ServiceCenterError('Incoming name belongs to another ID')
  }
  const refs = incoming.services.map(service => ({ id: service.id, categoryId: service.categoryId, nodeId: service.nodeId }))
  return { incoming, conflicts, newIds, refs }
}
export function previewImport(current: Catalog, input: unknown) {
  const plan = importPlan(current, input)
  return { revision: current.revision, sourceSchemaVersion: (input as { schemaVersion: number }).schemaVersion,
    count: plan.incoming.services.length, newIds: plan.newIds, conflicts: plan.conflicts, references: plan.refs }
}
export async function importManifest(expectedRevision: number, input: unknown, choices: unknown): Promise<Catalog> {
  if (!choices || typeof choices !== 'object' || Array.isArray(choices)) throw new ServiceCenterError('Conflict choices required')
  return mutateCatalog(expectedRevision, current => {
    const { incoming, conflicts } = importPlan(current, input)
    const selection = choices as Record<string, unknown>
    const conflictKeys = conflicts.map(item => item.key)
    if (Object.keys(selection).some(key => !conflictKeys.includes(key)) || conflictKeys.some(key => !['keep', 'overwrite'].includes(selection[key] as string))) throw new ServiceCenterError('Select keep or overwrite for every entity conflict')
    const merged = { schemaVersion: 2 as const, categories: [...current.categories], nodes: [...current.nodes], services: [...current.services] }
    for (const kind of ['categories', 'nodes', 'services'] as const) for (const item of incoming[kind]) {
      const target = merged[kind] as Array<Category | DeploymentNode | ServiceEntry>
      const index = target.findIndex(entry => entry.id === item.id)
      if (index < 0) target.push(item)
      else if (selection[`${kind}:${item.id}`] === 'overwrite') target[index] = item
    }
    return merged
  })
}
export async function isEditor(id: number): Promise<boolean> {
  return parseGrants(await readJson(grantPath())).editorIds.includes(id)
}
export async function listEditors(): Promise<number[]> { return parseGrants(await readJson(grantPath())).editorIds }
export async function setEditor(actorId: number, targetId: number, granted: boolean): Promise<number[]> {
  return update(grantPath(), raw => {
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
  return parseApprovals(await readJson(approvalPath()))[id] === url
}
export async function approveHealth(id: string, url: string, approved: boolean): Promise<void> {
  const catalogFile = catalogPath()
  const approvalFile = approvalPath()
  await updateFiles([catalogFile, approvalFile], raw => {
    const snapshot = parseCatalog(raw[catalogFile] ? JSON.parse(raw[catalogFile]) : undefined)
    if (snapshot.services.find(service => service.id === id)?.healthUrl !== url) throw new ServiceCenterError('Health URL changed; reload', 409)
    const next = { ...parseApprovals(raw[approvalFile] ? JSON.parse(raw[approvalFile]) : undefined) }
    if (approved) next[id] = url
    else delete next[id]
    return { files: { [approvalFile]: JSON.stringify(next) }, result: undefined }
  })
}
