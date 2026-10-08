import type { ClientExtensionSpec } from '../registry'
import { installServiceCenterClientHost } from './host'
import { serviceCenterMessages } from './messages'

export const serviceCenterClientExtension: ClientExtensionSpec = {
  id: 'service-center', version: '2.0.1',
  capabilities: ['directory', 'favorites', 'health', 'import-export', 'editor-grants', 'taxonomy', 'multi-entry'],
  initialize(host) {
    const dispose = installServiceCenterClientHost(host)
    return {
      route: { path: '/service-center', name: 'studio.serviceCenter', meta: { standalonePage: true },
        component: () => import('./ServiceCenterView.vue') },
      navigation(locale) {
        const messages = serviceCenterMessages[locale as keyof typeof serviceCenterMessages] || serviceCenterMessages.en
        return { key: 'serviceCenter', route: 'studio.serviceCenter', label: messages.title,
          path: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5' }
      },
      dispose,
    }
  },
}
