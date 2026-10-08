import { createHash } from 'crypto'

// Schema 2 is the tracked wire contract; cross-references and URL rules are runtime checks.
const schema = require('./manifest.schema.json') as {
  properties: { services: { maxItems: number; items: {
    required: string[]; properties: Record<string, { maxLength?: number; maxItems?: number; enum?: string[] }>
  } } }
}
const fields = schema.properties.services.items.properties
const required = schema.properties.services.items.required

export type Network = 'tailscale' | 'lan' | 'public' | 'local'
export interface Category { id: string; name: string; sortOrder: number }
export interface DeploymentNode { id: string; name: string; description: string; sortOrder: number }
export interface Endpoint { id: string; label: string; url: string; network: Network; login: 'unknown' | 'required' | 'none' }
export interface ServiceEntry {
  id: string
  name: string
  description: string
  icon: string
  categoryId: string | null
  nodeId: string | null
  tags: string[]
  endpoints: Endpoint[]
  defaultEndpointId: string
  enabled: boolean
  sortOrder: number
  healthUrl?: string
  healthCheckEnabled?: boolean
}
export interface ServiceManifest { schemaVersion: 2; categories: Category[]; nodes: DeploymentNode[]; services: ServiceEntry[] }
export interface LegacyServiceEntry extends Omit<ServiceEntry, 'categoryId' | 'nodeId' | 'endpoints' | 'defaultEndpointId'> { category: string; url: string; network: Network }
export interface LegacyManifest { schemaVersion: 1; services: LegacyServiceEntry[] }

export class ServiceCenterError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const string = (value: unknown, max: number, requiredValue = false): value is string =>
  typeof value === 'string' && value === value.trim() && value.length <= max &&
  (!requiredValue || value.length > 0) && !/[\u0000-\u001f\u007f<>]/.test(value)
const id = (value: unknown): value is string => string(value, 80, true) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
const order = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000
const keys = (value: Record<string, unknown>, allowed: string[], requiredKeys: string[]) =>
  !Object.keys(value).some(key => !allowed.includes(key)) && requiredKeys.every(key => Object.hasOwn(value, key))
const unique = (values: string[]) => new Set(values).size === values.length
const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase()
// Query-key deny lists cannot cover vendor-specific signed URLs or new
// credential aliases. Allow only ordinary navigation/filter keys and fail
// closed on everything else, including nested or still-encoded key names.
const benignQueryKeys = new Set([
  'view', 'category', 'tag', 'q', 'page', 'sort', 'lang', 'id',
  'name', 'filter', 'tab', 'ref', 'highlight',
])

function permittedQueryKey(key: string): boolean {
  // URLSearchParams has decoded the key once. A second %-decoding, separators,
  // Unicode aliases or numeric suffixes must not turn an unknown key into one
  // we accept; case-insensitive ASCII spelling is the only normalization.
  return /^[a-z]+$/i.test(key) && benignQueryKeys.has(key.toLowerCase())
}

function permittedFragment(hash: string): boolean {
  // Hash fragments are persisted/exported and sent to the browser even though
  // health GET omits them. Keep plain anchors/hash paths, never parameters or
  // encoded separators that a destination could decode as credential pairs.
  return !hash || /^#\/?[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\/?$/i.test(hash)
}

export function validateNavigationUrl(value: unknown): value is string {
  if (!string(value, 2048, true) || /[\\`\s]/.test(value)) return false
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return false
    if (url.href !== value && url.href !== `${value}/`) return false
    if (!permittedFragment(url.hash)) return false
    for (const key of url.searchParams.keys()) {
      if (!permittedQueryKey(key)) return false
    }
    return true
  } catch { return false }
}

function commonService(value: Record<string, unknown>) {
  if (!id(value.id) || !string(value.name, 100, true) || !string(value.description, 500) ||
    !fields.icon.enum!.includes(value.icon as string) || !Array.isArray(value.tags) ||
    value.tags.length > 12 || value.tags.some(tag => !string(tag, 40, true)) || !unique(value.tags) ||
    typeof value.enabled !== 'boolean' || !order(value.sortOrder) ||
    (value.healthUrl !== undefined && !validateNavigationUrl(value.healthUrl)) ||
    (value.healthCheckEnabled !== undefined && typeof value.healthCheckEnabled !== 'boolean') ||
    (value.healthCheckEnabled === true && !value.healthUrl)) throw new ServiceCenterError('Invalid service settings')
}
export function validateCategory(value: unknown): Category {
  if (!object(value) || !keys(value, ['id', 'name', 'sortOrder'], ['id', 'name', 'sortOrder']) ||
    !id(value.id) || !string(value.name, 80, true) || !order(value.sortOrder)) throw new ServiceCenterError('Invalid category')
  return value as unknown as Category
}
export function validateNode(value: unknown): DeploymentNode {
  if (!object(value) || !keys(value, ['id', 'name', 'description', 'sortOrder'], ['id', 'name', 'description', 'sortOrder']) ||
    !id(value.id) || !string(value.name, 80, true) || !string(value.description, 500) || !order(value.sortOrder)) throw new ServiceCenterError('Invalid deployment node')
  return value as unknown as DeploymentNode
}
export function validateService(value: unknown): ServiceEntry {
  if (!object(value) || !keys(value, Object.keys(fields), required)) throw new ServiceCenterError('Invalid service fields')
  commonService(value)
  if ((value.categoryId !== null && !id(value.categoryId)) || (value.nodeId !== null && !id(value.nodeId)) ||
    !Array.isArray(value.endpoints) || value.endpoints.length < 1 || value.endpoints.length > 8 || !id(value.defaultEndpointId)) throw new ServiceCenterError('Invalid service references or entrances')
  const endpoints = value.endpoints as unknown[]
  for (const endpoint of endpoints) {
    if (!object(endpoint) || !keys(endpoint, ['id', 'label', 'url', 'network', 'login'], ['id', 'label', 'url', 'network', 'login']) ||
      !id(endpoint.id) || !string(endpoint.label, 80, true) || !validateNavigationUrl(endpoint.url) ||
      !['tailscale', 'lan', 'public', 'local'].includes(endpoint.network as string) ||
      !['unknown', 'required', 'none'].includes(endpoint.login as string)) throw new ServiceCenterError('Invalid entrance')
  }
  const valid = endpoints as Endpoint[]
  if (!unique(valid.map(entry => entry.id)) || !unique(valid.map(entry => normalized(entry.label))) ||
    !valid.some(entry => entry.id === value.defaultEndpointId)) throw new ServiceCenterError('Duplicate or missing default entrance')
  return value as unknown as ServiceEntry
}
export function validateManifest(value: unknown): ServiceManifest {
  if (!object(value) || !keys(value, ['schemaVersion', 'categories', 'nodes', 'services'], ['schemaVersion', 'categories', 'nodes', 'services']) ||
    value.schemaVersion !== 2 || !Array.isArray(value.categories) || value.categories.length > 100 ||
    !Array.isArray(value.nodes) || value.nodes.length > 100 || !Array.isArray(value.services) ||
    value.services.length > schema.properties.services.maxItems) throw new ServiceCenterError('Unsupported or invalid manifest schemaVersion')
  const categories = value.categories.map(validateCategory)
  const nodes = value.nodes.map(validateNode)
  const services = value.services.map(validateService)
  for (const collection of [categories, nodes]) {
    if (!unique(collection.map(item => item.id)) || !unique(collection.map(item => normalized(item.name)))) throw new ServiceCenterError('Duplicate organization ID or name')
  }
  if (!unique(services.map(service => service.id)) || services.some(service =>
    (service.categoryId !== null && !categories.some(item => item.id === service.categoryId)) ||
    (service.nodeId !== null && !nodes.some(item => item.id === service.nodeId)))) throw new ServiceCenterError('Duplicate service ID or invalid reference')
  return { schemaVersion: 2, categories, nodes, services }
}

function validateLegacyService(value: unknown): LegacyServiceEntry {
  const legacyFields = ['id', 'name', 'description', 'url', 'icon', 'category', 'tags', 'network', 'enabled', 'sortOrder', 'healthUrl', 'healthCheckEnabled']
  if (!object(value) || !keys(value, legacyFields, legacyFields.slice(0, 10))) throw new ServiceCenterError('Invalid legacy service fields')
  commonService(value)
  if (!string(value.category, 80, true) || !validateNavigationUrl(value.url) ||
    !['tailscale', 'lan', 'public', 'local'].includes(value.network as string)) throw new ServiceCenterError('Invalid legacy service')
  return value as unknown as LegacyServiceEntry
}
export function validateLegacyManifest(value: unknown): LegacyManifest {
  if (!object(value) || !keys(value, ['schemaVersion', 'services'], ['schemaVersion', 'services']) ||
    value.schemaVersion !== 1 || !Array.isArray(value.services) || value.services.length > 200) throw new ServiceCenterError('Invalid legacy manifest')
  const services = value.services.map(validateLegacyService)
  if (!unique(services.map(service => service.id))) throw new ServiceCenterError('Duplicate service ID')
  return { schemaVersion: 1, services }
}
export function legacyCategoryId(name: string): string {
  const slug = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 54) || 'category'
  return `${slug}-${createHash('sha256').update(name).digest('hex').slice(0, 12)}`
}
export function normalizeLegacy(input: unknown, existing: Category[] = []): ServiceManifest {
  const legacy = validateLegacyManifest(input)
  const categories = [...existing]
  const names = [...new Set(legacy.services.map(service => service.category))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  for (const name of names) {
    if (categories.some(item => normalized(item.name) === normalized(name))) continue
    let candidate = legacyCategoryId(name)
    let suffix = 1
    while (categories.some(item => item.id === candidate)) candidate = `${legacyCategoryId(name)}-${suffix++}`
    categories.push({ id: candidate, name, sortOrder: categories.length })
  }
  const services = legacy.services.map(({ category, url, network, ...service }) => ({ ...service,
    categoryId: categories.find(item => normalized(item.name) === normalized(category))!.id,
    nodeId: null, endpoints: [{ id: 'primary', label: 'Primary', url, network, login: 'unknown' as const }], defaultEndpointId: 'primary',
  }))
  return validateManifest({ schemaVersion: 2, categories, nodes: [], services })
}
