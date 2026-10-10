// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ModelPresetBar from '@/components/hermes/chat/ModelPresetBar.vue'
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('naive-ui', () => ({ NTooltip: { template: '<div><slot name="trigger"/><slot/></div>' } }))
const presets = [
  { id: 'basic', label: 'basic', providerId: 'openai-codex', modelId: 'gpt-6-luna', reasoningLevel: 'medium' },
  { id: 'default', label: 'default', providerId: 'openai-codex', modelId: 'gpt-6.1-sol', reasoningLevel: 'low' },
  { id: 'deep', label: 'deep', providerId: 'openai-codex', modelId: 'gpt-6.1-sol', reasoningLevel: 'high' },
  { id: 'extreme', label: 'extreme', providerId: 'openai-codex', modelId: 'gpt-6-astra', reasoningLevel: 'medium' },
]
function render(extra: Record<string, unknown> = {}) {
  return mount(ModelPresetBar, { props: { presets, preview: presets[0], defaultPresetId: 'default', fast: false, supportsFast: false, issues: {}, ...extra } })
}
describe('pure controlled model preset bar', () => {
  it('renders the user order, not a sorted reasoning ladder, without any Pinia or API dependency', () => {
    const wrapper = render()
    const dots = wrapper.findAll('.composer-step-dot')
    expect(dots.map(dot => dot.get('.preset-position-label').text())).toEqual(['basic', 'default', 'deep', 'extreme'])
    expect(dots.map(dot => dot.attributes('title'))).toEqual(presets.map(p => `${p.label} · ${p.providerId}/${p.modelId} · chat.reasoningEffort.options.${p.reasoningLevel}`))
    expect(wrapper.get('.composer-step-slider').attributes('max')).toBe('3')
    expect(wrapper.get('.composer-model-name').text()).toBe('gpt-6-luna')
  })
  it('emits only a preview selection intent and requires props to change actual display', async () => {
    const select = vi.fn(); const wrapper = render({ onSelect: select })
    await wrapper.get('.composer-step-slider').setValue('3')
    expect(select).toHaveBeenCalledWith(3)
    expect(wrapper.get('.composer-model-name').text()).toBe('gpt-6-luna')
    await wrapper.setProps({ preview: presets[3] })
    expect(wrapper.get('.composer-model-name').text()).toBe('gpt-6-astra')
    expect(wrapper.get('.composer-effort-name').text()).toBe('chat.reasoningEffort.options.medium')
  })
  it('retains stable selection after reordering the same ids', async () => {
    const wrapper = render({ preview: presets[1] })
    await wrapper.setProps({ presets: [presets[3], presets[0], presets[2], presets[1]] })
    expect((wrapper.get('.composer-step-slider').element as HTMLInputElement).value).toBe('3')
    expect(wrapper.get('.composer-step-label').text()).toBe('default')
  })
  it('does not invent slider positions for an empty config; offers the existing Models tab', async () => {
    const manage = vi.fn(); const wrapper = render({ presets: [], onManage: manage })
    expect(wrapper.find('.composer-step-slider').exists()).toBe(false)
    expect(wrapper.get('[data-testid="preset-empty"]').text()).toContain('composer.noPresets')
    await wrapper.get('.preset-configure').trigger('click')
    expect(manage).toHaveBeenCalledOnce()
  })
})
