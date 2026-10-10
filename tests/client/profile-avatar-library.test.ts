// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ProfileAvatar from '@/components/hermes/profiles/ProfileAvatar.vue'
import { resolveLibraryAvatar } from '@/utils/avatar-library'

describe('shared profile/avatar renderer', () => {
  it('uses only the displayed library URL, with no eager fetch of the 50 assets', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const first = resolveLibraryAvatar({ type: 'library', assetId: 'ip-012', revision: 3 })!
    const wrapper = mount(ProfileAvatar, { props: { name: 'owner', avatar: first, size: 48 } })
    expect(wrapper.get('img').attributes('src')).toBe(first.url)
    expect(fetchSpy).not.toHaveBeenCalled()
    wrapper.unmount()
    fetchSpy.mockRestore()
  })
  it('falls back on missing library assets instead of trusting arbitrary URLs', () => {
    const wrapper = mount(ProfileAvatar, { props: { name: 'owner', avatar: { type: 'library', assetId: '../etc', revision: 3, url: 'https://attacker.invalid' } } })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('.profile-avatar-svg').exists()).toBe(true)
    wrapper.unmount()
  })
})
