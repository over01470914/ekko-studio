import type { ServerExtensionSpec } from '../registry'
import { installServiceCenterHost, type ServiceCenterHost } from './host'
import { serviceCenterRoutes } from './routes'

export function serviceCenterExtension(host: ServiceCenterHost): ServerExtensionSpec {
  return {
    id: 'service-center', version: '2.0.1', contractVersion: 1,
    apiBase: '/api/studio/service-center',
    capabilities: ['directory', 'favorites', 'health', 'import-export', 'editor-grants', 'taxonomy', 'multi-entry'],
    initialize() {
      const dispose = installServiceCenterHost(host)
      return { routes: serviceCenterRoutes, dispose }
    },
  }
}
