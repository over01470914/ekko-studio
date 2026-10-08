import { serviceCenterClientHost } from './host'
const request = <T>(path: string, options?: RequestInit) => serviceCenterClientHost().request<T>(path, options)

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
export interface Manifest { schemaVersion: 2; categories: Category[]; nodes: DeploymentNode[]; services: ServiceEntry[] }
export interface LegacyManifest { schemaVersion: 1; services: Array<Omit<ServiceEntry, 'categoryId' | 'nodeId' | 'endpoints' | 'defaultEndpointId'> & { category: string; url: string; network: Network }> }
export interface HealthResult { state: string; checkedAt: string | null; latencyMs: number | null; status: number | null }
export interface CatalogResponse {
  schemaVersion: 2
  revision: number
  categories: Category[]
  nodes: DeploymentNode[]
  services: ServiceEntry[]
  favorites: string[]
  health: Record<string, HealthResult>
  capabilities: { canManageServices: boolean; canManageEditors: boolean }
}
export interface ImportPreview { revision: number; sourceSchemaVersion: 1 | 2; count: number;
  newIds: { categories: string[]; nodes: string[]; services: string[] };
  conflicts: Array<{ key: string; entity: 'categories' | 'nodes' | 'services'; id: string; current: Category | DeploymentNode | ServiceEntry; incoming: Category | DeploymentNode | ServiceEntry }>; references: Array<{ id: string; categoryId: string | null; nodeId: string | null }> }
const base = '/api/studio/service-center'
export const fetchCatalog = () => request<CatalogResponse>(`${base}/catalog`)
export const exportManifest = () => request<Manifest>(`${base}/manifest`)
export const saveService = (expectedRevision: number, service: ServiceEntry) => request<{ revision: number }>(`${base}/services`, { method: 'PUT', body: JSON.stringify({ expectedRevision, service }) })
export const deleteService = (expectedRevision: number, id: string) => request<{ revision: number }>(`${base}/services/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ expectedRevision }) })
export const saveCategory = (expectedRevision: number, category: Category) => request<{ revision: number }>(`${base}/categories`, { method: 'PUT', body: JSON.stringify({ expectedRevision, category }) })
export const deleteCategory = (expectedRevision: number, id: string, reassignTo: string | null) => request<{ revision: number }>(`${base}/categories/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ expectedRevision, reassignTo }) })
export const saveNode = (expectedRevision: number, node: DeploymentNode) => request<{ revision: number }>(`${base}/nodes`, { method: 'PUT', body: JSON.stringify({ expectedRevision, node }) })
export const deleteNode = (expectedRevision: number, id: string, reassignTo: string | null) => request<{ revision: number }>(`${base}/nodes/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ expectedRevision, reassignTo }) })
export const previewImport = (manifest: Manifest | LegacyManifest) => request<ImportPreview>(`${base}/import/preview`, { method: 'POST', body: JSON.stringify({ manifest }) })
export const confirmImport = (expectedRevision: number, manifest: Manifest | LegacyManifest, conflicts: Record<string, 'keep' | 'overwrite'>) => request<{ revision: number }>(`${base}/import/confirm`, { method: 'POST', body: JSON.stringify({ expectedRevision, manifest, conflicts }) })
export const setFavorite = (id: string, favorite: boolean) => request<{ favorites: string[] }>(`${base}/favorites/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ favorite }) })
export const checkHealth = (id: string) => request<HealthResult>(`${base}/health/${encodeURIComponent(id)}`, { method: 'POST' })
export const approveHealth = (id: string, approved: boolean) => request<{ approved: boolean }>(`${base}/health/${encodeURIComponent(id)}/approval`, { method: 'PUT', body: JSON.stringify({ approved }) })
export const fetchEditors = () => request<{ editorIds: number[] }>(`${base}/editors`)
export const setEditor = (id: number, granted: boolean) => request<{ editorIds: number[] }>(`${base}/editors/${id}`, { method: 'PUT', body: JSON.stringify({ granted }) })
export const fetchManagedUsers = () => serviceCenterClientHost().managedUsers()
