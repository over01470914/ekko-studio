// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { shallowMount } from '@vue/test-utils'
import PersonalAgentView from '../../packages/client/src/modules/studio-extensions/personal-agent/PersonalAgentView.vue'
import { installPersonalAgentHost } from '../../packages/client/src/modules/studio-extensions/personal-agent/host'
let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); localStorage.clear() })
describe('native personal entry preference', () => {
  it.each(['workbench', 'personal'])('retains explicit %s choice on next native launch without starting an Agent', mode => {
    localStorage.setItem('studio_entry_mode', mode)
    dispose = installPersonalAgentHost({ locale: ref('en'), theme: ref('light'), request: async <T>(path: string) => (path.endsWith('/central/state') ? { configured: false, connected: false } : { configured: false, workspaces: [], peers: [] }) as T, managedUsers: async () => ({ users: [] }), hasSession: () => true, onAuthInvalidated: () => () => {} })
    const wrapper = shallowMount(PersonalAgentView, { props: { standalone: true } })
    expect(wrapper.find('.mode-chooser').exists()).toBe(false)
    expect(wrapper.find('.conversation').exists()).toBe(mode === 'workbench')
    expect(wrapper.find('.files-card').exists()).toBe(mode === 'personal'); wrapper.unmount()
  })
})
