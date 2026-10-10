import type { ServerExtensionSpec } from '../registry'
import type { PersonalAgentHost } from './host'
import { createPersonalAgentRoutes } from './routes'

export function personalAgentExtension(host: PersonalAgentHost): ServerExtensionSpec {
  return { id: 'personal-agent', version: '0.1.0', contractVersion: 1, apiBase: '/api/studio/personal-agent',
    capabilities: ['workspace-files'], initialize() {
      const service = host.createService()
      return { routes: createPersonalAgentRoutes(host, service), dispose: () => { service?.close(); host.central?.close() } }
    } }
}
