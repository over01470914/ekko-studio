import type { ServerExtensionSpec } from '../registry'
import { installServiceCenterHost, type ServiceCenterHost } from './host'
import { serviceCenterRoutes } from './routes'

export function serviceCenterExtension(host: ServiceCenterHost): ServerExtensionSpec {
  return {
    id: 'service-center', version: '1.1.0', contractVersion: 1,
    apiBase: '/api/studio/service-center',
    capabilities: ['directory', 'favorites', 'health', 'import-export', 'editor-grants'],
    initialize() {
      const dispose = installServiceCenterHost(host)
      return { routes: serviceCenterRoutes, dispose }
    },
  }
}
