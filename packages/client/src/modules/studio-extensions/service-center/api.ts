import { serviceCenterClientHost } from './host'
const request = <T>(path: string, options?: RequestInit) => serviceCenterClientHost().request<T>(path, options)

export type Network = 'tailscale' | 'lan' | 'public' | 'local'
export interface ServiceEntry {
  id: string
  name: string
  description: string
  url: string
  icon: string
  category: string
  tags: string[]
  network: Network
  enabled: boolean
  sortOrder: number
  healthUrl?: string
  healthCheckEnabled?: boolean
}
export interface Manifest { schemaVersion: 1; services: ServiceEntry[] }
export interface HealthResult { state: string; checkedAt: string | null; latencyMs: number | null; status: number | null }
export interface CatalogResponse {
  revision: number
  services: ServiceEntry[]
  favorites: string[]
  health: Record<string, HealthResult>
  capabilities: { canManageServices: boolean; canManageEditors: boolean }
}
export interface ImportPreview { revision: number; count: number; newIds: string[]; conflicts: Array<{ id: string; current: ServiceEntry; incoming: ServiceEntry }> }
const base = '/api/studio/service-center'
export const fetchCatalog = () => request<CatalogResponse>(`${base}/catalog`)
export const exportManifest = () => request<Manifest>(`${base}/manifest`)
export const saveService = (expectedRevision: number, service: ServiceEntry) => request<{ revision: number }>(`${base}/services`, { method: 'PUT', body: JSON.stringify({ expectedRevision, service }) })
export const deleteService = (expectedRevision: number, id: string) => request<{ revision: number }>(`${base}/services/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ expectedRevision }) })
export const previewImport = (manifest: Manifest) => request<ImportPreview>(`${base}/import/preview`, { method: 'POST', body: JSON.stringify({ manifest }) })
export const confirmImport = (expectedRevision: number, manifest: Manifest, conflicts: Record<string, 'keep' | 'overwrite'>) => request<{ revision: number }>(`${base}/import/confirm`, { method: 'POST', body: JSON.stringify({ expectedRevision, manifest, conflicts }) })
export const setFavorite = (id: string, favorite: boolean) => request<{ favorites: string[] }>(`${base}/favorites/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ favorite }) })
export const checkHealth = (id: string) => request<HealthResult>(`${base}/health/${encodeURIComponent(id)}`, { method: 'POST' })
export const approveHealth = (id: string, approved: boolean) => request<{ approved: boolean }>(`${base}/health/${encodeURIComponent(id)}/approval`, { method: 'PUT', body: JSON.stringify({ approved }) })
export const fetchEditors = () => request<{ editorIds: number[] }>(`${base}/editors`)
export const setEditor = (id: number, granted: boolean) => request<{ editorIds: number[] }>(`${base}/editors/${id}`, { method: 'PUT', body: JSON.stringify({ granted }) })
export const fetchManagedUsers = () => serviceCenterClientHost().managedUsers()
