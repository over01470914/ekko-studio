// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createClientExtensionRegistry, extensionNavigation } from '../../packages/client/src/modules/studio-extensions/registry'
import { personalAgentClientExtension } from '../../packages/client/src/modules/studio-extensions/personal-agent'
import { offerExtensionEntry } from '../../packages/client/src/bootstrap/extension-entry'
import { personalAgentMessages } from '../../packages/client/src/modules/studio-extensions/personal-agent/messages'

describe('opt-in personal entry and mode compatibility', () => {
  it.each([{ extensions: [] }, { extensions: [{ id: 'personal-agent', version: '9.0.0', apiBase: '/api/studio/personal-agent', capabilities: ['workspace-files'] }] }])('keeps core unchanged for disabled/missing/incompatible discovery', async ({ extensions }) => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/hermes/chat', name: 'workbench', component: {} }] })
    const registry = createClientExtensionRegistry(router, { request: async <T>() => ({ contractVersion: 1, extensions }) as T, managedUsers: async () => ({ users: [] }), hasSession: () => true, onAuthInvalidated: () => () => {}, locale: ref('en'), theme: ref('light') }, [personalAgentClientExtension])
    await registry.ensure(); expect(router.hasRoute('studio.personalAgent')).toBe(false); expect(router.hasRoute('workbench')).toBe(true); expect(extensionNavigation.value).toEqual([]); registry.dispose()
  })
  it('offers default landing once and does not hijack session/history/share/group or explicit workbench links', () => {
    const root = { fullPath: '/hermes/chat', redirectedFrom: { path: '/' } } as any
    expect(offerExtensionEntry(root, { name: undefined }, true, null)).toBe(true)
    expect(offerExtensionEntry(root, { name: undefined }, false, null)).toBe(false)
    expect(offerExtensionEntry(root, { name: undefined }, true, 'workbench')).toBe(false)
    for (const fullPath of ['/hermes/chat?session=stable', '/hermes/history', '/share/stable', '/group-chat/42']) expect(offerExtensionEntry({ fullPath } as any, { name: 'login' }, true, null)).toBe(false)
    expect(offerExtensionEntry({ fullPath: '/hermes/chat' } as any, { name: undefined }, true, null)).toBe(false)
  })
  it('has module-local messages for all 11 Studio locales', () => {
    expect(Object.keys(personalAgentMessages).sort()).toEqual(['en', 'zh-TW', 'zh', 'ja', 'ko', 'fr', 'es', 'de', 'pt', 'ru', 'ar'].sort())
    for (const dictionary of Object.values(personalAgentMessages)) expect(Object.keys(dictionary)).toEqual(Object.keys(personalAgentMessages.en))
  })
})
