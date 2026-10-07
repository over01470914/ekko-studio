// JSON Schema is the tracked v1 wire contract; these checks enforce its bounds
// and the URL security rules that JSON Schema alone cannot express.
const schema = require('./manifest.schema.json') as {
  properties: { services: { maxItems: number; items: {
    required: string[]; properties: Record<string, { maxLength?: number; maxItems?: number; enum?: string[] }>
  } } }
}
const fields = schema.properties.services.items.properties
const required = schema.properties.services.items.required

export interface ServiceEntry {
  id: string
  name: string
  description: string
  url: string
  icon: string
  category: string
  tags: string[]
  network: 'tailscale' | 'lan' | 'public' | 'local'
  enabled: boolean
  sortOrder: number
  healthUrl?: string
  healthCheckEnabled?: boolean
}
export interface ServiceManifest { schemaVersion: 1; services: ServiceEntry[] }

export class ServiceCenterError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const string = (value: unknown, max: number, requiredValue = false): value is string =>
  typeof value === 'string' && value === value.trim() && value.length <= max &&
  (!requiredValue || value.length > 0) && !/[\u0000-\u001f\u007f<>]/.test(value)
const secretKey = /(?:^|[_-])(token|key|secret|password|passwd|pwd|credential|auth|authorization|session|cookie|jwt|api.?key|bearer|signature|sig)(?:$|[_-]|id$)/i

function credentialQueryKey(key: string): boolean {
  // URLSearchParams decodes the key, but separators and camelCase must both be
  // treated as word boundaries (accessToken, clientSecret, APIKey, etc.).
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()
  return secretKey.test(normalized) ||
    /^(?:access|refresh|client|api|private)(?:token|secret|key|password|credential)$/.test(normalized)
}

export function validateNavigationUrl(value: unknown): value is string {
  if (!string(value, 2048, true) || /[\\`\s]/.test(value)) return false
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return false
    if (url.href !== value && url.href !== `${value}/`) return false
    for (const key of url.searchParams.keys()) {
      if (credentialQueryKey(key)) return false
    }
    return true
  } catch { return false }
}

export function validateService(value: unknown): ServiceEntry {
  if (!object(value) || Object.keys(value).some(key => !Object.hasOwn(fields, key)) ||
    required.some(key => !Object.hasOwn(value, key))) throw new ServiceCenterError('Invalid service fields')
  if (!string(value.id, fields.id.maxLength!, true) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) throw new ServiceCenterError('Invalid service ID')
  for (const key of ['name', 'description', 'category'] as const) {
    if (!string(value[key], fields[key].maxLength!, key !== 'description')) throw new ServiceCenterError(`Invalid ${key}`)
  }
  if (!validateNavigationUrl(value.url) || (value.healthUrl !== undefined && !validateNavigationUrl(value.healthUrl))) throw new ServiceCenterError('Invalid HTTP(S) URL')
  if (!fields.icon.enum!.includes(value.icon as string) || !fields.network.enum!.includes(value.network as string)) throw new ServiceCenterError('Invalid icon or network')
  if (!Array.isArray(value.tags) || value.tags.length > fields.tags.maxItems! ||
    value.tags.some(tag => !string(tag, 40, true)) || new Set(value.tags).size !== value.tags.length) throw new ServiceCenterError('Invalid tags')
  if (typeof value.enabled !== 'boolean' || !Number.isInteger(value.sortOrder) ||
    (value.sortOrder as number) < 0 || (value.sortOrder as number) > 1_000_000 ||
    (value.healthCheckEnabled !== undefined && typeof value.healthCheckEnabled !== 'boolean') ||
    (value.healthCheckEnabled === true && !value.healthUrl)) throw new ServiceCenterError('Invalid service settings')
  return value as unknown as ServiceEntry
}

export function validateManifest(value: unknown): ServiceManifest {
  if (!object(value) || Object.keys(value).some(key => !['schemaVersion', 'services'].includes(key)) ||
    value.schemaVersion !== 1 || !Array.isArray(value.services) || value.services.length > schema.properties.services.maxItems) {
    throw new ServiceCenterError('Unsupported or invalid manifest schemaVersion')
  }
  const services = value.services.map(validateService)
  if (new Set(services.map(service => service.id)).size !== services.length) throw new ServiceCenterError('Duplicate service ID')
  return { schemaVersion: 1, services }
}
