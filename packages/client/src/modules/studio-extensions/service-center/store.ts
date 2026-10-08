import { defineStore } from 'pinia'
import { ref } from 'vue'
import { onServiceCenterReset } from './host'
import * as api from './api'
import type { CatalogResponse, HealthResult, ServiceEntry } from './api'

const empty = (): CatalogResponse => ({ schemaVersion: 2, revision: 0, categories: [], nodes: [], services: [], favorites: [], health: {}, capabilities: { canManageServices: false, canManageEditors: false } })
export const useServiceCenterStore = defineStore('serviceCenter', () => {
  const catalog = ref<CatalogResponse>(empty())
  const loading = ref(false)
  const error = ref('')
  let requestId = 0
  onServiceCenterReset(() => { requestId++; catalog.value = empty(); error.value = ''; loading.value = false })

  async function refresh() {
    const current = ++requestId
    loading.value = true
    error.value = ''
    try {
      const result = await api.fetchCatalog()
      if (current === requestId) catalog.value = result
    } catch (failure) {
      if (current === requestId) { catalog.value = empty(); error.value = (failure as Error).message }
    } finally { if (current === requestId) loading.value = false }
  }
  async function save(service: ServiceEntry) {
    await api.saveService(catalog.value.revision, service)
    await refresh()
  }
  async function remove(id: string) {
    await api.deleteService(catalog.value.revision, id)
    await refresh()
  }
  async function favorite(id: string) {
    const result = await api.setFavorite(id, !catalog.value.favorites.includes(id))
    catalog.value.favorites = result.favorites
  }
  async function check(id: string) {
    const result: HealthResult = await api.checkHealth(id)
    catalog.value.health[id] = result
  }
  return { catalog, loading, error, refresh, save, remove, favorite, check }
})
