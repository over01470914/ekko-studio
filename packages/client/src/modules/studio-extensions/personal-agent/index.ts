import type { ClientExtensionSpec } from '../registry'
import { installPersonalAgentHost } from './host'
import { personalAgentMessages } from './messages'
export const personalAgentClientExtension: ClientExtensionSpec = {
  id: 'personal-agent', version: '0.1.0', capabilities: ['workspace-files'],
  initialize(host) {
    const dispose = installPersonalAgentHost(host)
    return { route: { path: '/personal-agent', name: 'studio.personalAgent', component: () => import('./PersonalAgentView.vue'), meta: { requiresAuth: true, clientOnly: true } },
      navigation: (locale: string) => ({ key: 'studio.personalAgent', route: 'studio.personalAgent', path: '/personal-agent', label: (personalAgentMessages[locale] || personalAgentMessages.en).title }), dispose }
  },
}
