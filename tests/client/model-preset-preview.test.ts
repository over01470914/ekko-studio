// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { nextTick } from 'vue'
import ModelPresetPreview from '@/components/hermes/chat/ModelPresetPreview.vue'
import { useChatStore } from '@/stores/hermes/chat'
import { useAppStore } from '@/stores/hermes/app'
import { useProfilesStore } from '@/stores/hermes/profiles'
import { useModelPresetsStore } from '@/stores/hermes/model-presets'
import type { ModelPreset } from '@/types/model-presets'

const error = vi.hoisted(() => vi.fn())
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('naive-ui', () => ({
  NTooltip: { template: '<div><slot name="trigger" /><slot /></div>' },
  useMessage: () => ({ error }),
}))

const steps: ModelPreset[] = [
  { id: 'quick', label: 'Quick', providerId: 'openai', modelId: 'fast-model', reasoningLevel: 'low' },
  { id: 'deep', label: 'Deep', providerId: 'other', modelId: 'deep-model', reasoningLevel: 'high' },
]
const groups = [
  { provider: 'openai', label: 'OpenAI', models: ['fast-model', 'disabled-model', 'unknown-capabilities'], model_meta: {
    'fast-model': { fast_mode: true, reasoning_efforts: ['low', 'high'] },
    'disabled-model': { disabled: true },
  } },
  { provider: 'other', label: 'Other', models: ['deep-model'], model_meta: { 'deep-model': { reasoning_efforts: ['high'] } } },
]
const mounted: VueWrapper[] = []
function setup(presets: ModelPreset[] = steps, overrides: Record<string, unknown> = {}) {
  const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false })
  const chat = useChatStore()
  const app = useAppStore()
  useProfilesStore().activeProfileName = 'default'
  app.modelGroups = groups
  app.profileModelGroups = [{ profile: 'default', groups }]
  app.selectedProvider = 'openai'
  app.selectedModel = 'fast-model'
  const config = useModelPresetsStore()
  config.hydrate('default', { composer_steps: presets.map(step => ({ ...step })), composer_default_step_id: 'deep' })
  chat.sessions = [{ id: 'session', title: 'Test', source: 'builtin_agent', agent: 'ekko-agent',
    codingAgentId: 'ekko-agent', codingAgentMode: 'scoped', profile: 'default', isLocalOnly: true,
    provider: 'openai', model: 'fast-model', reasoningEffort: 'low', messages: [],
    createdAt: 1, updatedAt: 1, ...overrides }]
  chat.activeSessionId = 'session'
  chat.activeSession = chat.sessions[0]
  const wrapper = mount(ModelPresetPreview, { global: { plugins: [pinia] } })
  mounted.push(wrapper)
  return { wrapper, chat, app, config }
}
const disabled = (wrapper: VueWrapper, selector: string) => (wrapper.get(selector).element as HTMLButtonElement).disabled

beforeEach(() => { localStorage.clear(); error.mockReset() })
afterEach(() => { mounted.splice(0).forEach(wrapper => wrapper.unmount()); vi.useRealTimers() })

async function openPreview(wrapper: VueWrapper) {
  await wrapper.get('.composer-launcher').trigger('mouseenter')
  expect(wrapper.get('.composer-launcher').attributes('aria-expanded')).toBe('true')
}
async function closeOutside() {
  document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  await flushPromises()
}
describe('Composer preview panel', () => {
  it('discards a preview if model controls become disabled before close', async () => {
    const { wrapper, chat } = setup()
    await openPreview(wrapper)
    await wrapper.get('.composer-step-slider').setValue('1')
    await wrapper.setProps({ modelDisabled: true })
    expect(wrapper.find('.composer-model-bar').exists()).toBe(false)
    expect(chat.applyModelPreset).not.toHaveBeenCalled()
  })
  it('shows an error if final Fast capability no longer permits the preview', async () => {
    const { wrapper, chat } = setup()
    await openPreview(wrapper)
    await wrapper.get('.composer-fast-toggle').trigger('click')
    vi.mocked(chat.setSessionFastMode).mockReturnValueOnce(false)
    await closeOutside()
    expect(error).toHaveBeenCalledWith('composer.fastUnavailable')
    expect(chat.activeSession?.fastMode).not.toBe(true)
  })

  it.each(['false', 'throw'])('reports failed close (%s) without Fast or fake success', async failure => {
    const { wrapper, chat } = setup()
    if (failure === 'false') vi.mocked(chat.applyModelPreset).mockResolvedValueOnce(false)
    else vi.mocked(chat.applyModelPreset).mockRejectedValueOnce(new Error('backend failure'))
    await openPreview(wrapper)
    await wrapper.findAll('.composer-step-dot')[1].trigger('click')
    await closeOutside()
    expect(error).toHaveBeenCalledExactlyOnceWith('composer.switchFailed')
    expect(chat.activeSession).toMatchObject({ model: 'fast-model', reasoningEffort: 'low' })
    expect(chat.setSessionFastMode).not.toHaveBeenCalled()
    expect(disabled(wrapper, '.composer-launcher')).toBe(false)
    await openPreview(wrapper)
    expect(wrapper.get('.composer-step-label').text()).toBe('Quick')
  })
  it('discards unmounted preview and pending leave timer', async () => {
    vi.useFakeTimers()
    const { wrapper, chat } = setup()
    await openPreview(wrapper)
    await wrapper.findAll('.composer-step-dot')[1].trigger('click')
    await wrapper.get('.composer-control').trigger('mouseleave')
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(120)
    expect(chat.applyModelPreset).not.toHaveBeenCalled()
    expect(chat.setSessionFastMode).not.toHaveBeenCalled()
  })
  it('Escape commits once despite pending leave timer', async () => {
    vi.useFakeTimers()
    const { wrapper, chat } = setup()
    await openPreview(wrapper)
    await wrapper.findAll('.composer-step-dot')[1].trigger('click')
    await wrapper.get('.composer-control').trigger('mouseleave')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(120)
    expect(chat.applyModelPreset).toHaveBeenCalledTimes(1)
  })
  it('is lazy and opens on hover or click without writing session settings', async () => {
    const { wrapper, chat } = setup()
    expect(wrapper.find('.composer-model-bar').exists()).toBe(false)
    await openPreview(wrapper)
    expect(chat.applyModelPreset).not.toHaveBeenCalled()
    // Clicking an already hover-opened trigger keeps it open, rather than immediately closing it.
    await wrapper.get('.composer-launcher').trigger('click')
    expect(wrapper.find('.composer-model-bar').exists()).toBe(true)
    await wrapper.get('.composer-launcher').trigger('click')
    expect(wrapper.find('.composer-model-bar').exists()).toBe(false)
    expect(chat.applyModelPreset).not.toHaveBeenCalled()
    await wrapper.get('.composer-launcher').trigger('click')
    expect(wrapper.find('.composer-model-bar').exists()).toBe(true)
  })
  it('allows many slider inputs immediately, applies only the last combination on close', async () => {
    const { wrapper, chat } = setup()
    await openPreview(wrapper)
    const slider = wrapper.get('.composer-step-slider')
    ;(slider.element as HTMLInputElement).value = '1'
    await slider.trigger('input')
    expect(wrapper.get('.composer-step-label').text()).toBe('Deep')
    expect(chat.activeSession).toMatchObject({ model: 'fast-model', reasoningEffort: 'low' })
    expect(chat.applyModelPreset).not.toHaveBeenCalled()
    await slider.setValue('0')
    await slider.setValue('1')
    expect(slider.attributes('disabled')).toBeUndefined()
    await closeOutside()
    expect(chat.applyModelPreset).toHaveBeenCalledTimes(1)
    expect(chat.applyModelPreset).toHaveBeenCalledWith('session', steps[1])
    expect(chat.activeSession).toMatchObject({ provider: 'other', model: 'deep-model', reasoningEffort: 'high' })
  })
  it('does not write anything when dragging returns to the starting combination', async () => {
    const { wrapper, chat } = setup()
    await openPreview(wrapper)
    await wrapper.get('.composer-step-slider').setValue('1')
    await wrapper.get('.composer-step-slider').setValue('0')
    await closeOutside()
    expect(chat.applyModelPreset).not.toHaveBeenCalled()
    expect(chat.setSessionFastMode).not.toHaveBeenCalled()
  })
  it('previews Fast independently, writes only after close', async () => {
    const { wrapper, chat } = setup()
    await openPreview(wrapper)
    await wrapper.get('.composer-fast-toggle').trigger('click')
    expect(wrapper.get('.composer-fast-toggle').attributes('aria-pressed')).toBe('true')
    expect(chat.activeSession?.fastMode).not.toBe(true)
    expect(chat.setSessionFastMode).not.toHaveBeenCalled()
    await closeOutside()
    expect(chat.setSessionFastMode).toHaveBeenCalledWith('session', true)
    expect(chat.activeSession).toMatchObject({ fastMode: true, reasoningEffort: 'low' })
    expect(chat.applyModelPreset).not.toHaveBeenCalled()
  })
  it('commits on leaving the whole region, but entering the panel cancels a transient leave', async () => {
    vi.useFakeTimers()
    const { wrapper, chat } = setup()
    await openPreview(wrapper)
    await wrapper.findAll('.composer-step-dot')[1].trigger('click')
    await wrapper.get('.composer-control').trigger('mouseleave')
    await wrapper.get('.composer-panel-wrap').trigger('mouseenter')
    await vi.advanceTimersByTimeAsync(150)
    expect(chat.applyModelPreset).not.toHaveBeenCalled()
    expect(wrapper.find('.composer-model-bar').exists()).toBe(true)
    await wrapper.get('.composer-control').trigger('mouseleave')
    await vi.advanceTimersByTimeAsync(119)
    expect(chat.applyModelPreset).not.toHaveBeenCalled()
    expect(wrapper.find('.composer-model-bar').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(chat.applyModelPreset).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.composer-model-bar').exists()).toBe(false)
  })
  it('disables invalid models and reasoning without hiding them', async () => {
    const { wrapper } = setup([...steps,
      { ...steps[0], id: 'missing', modelId: 'missing' },
      { ...steps[0], id: 'disabled', modelId: 'disabled-model' },
      { ...steps[0], id: 'invalid', reasoningLevel: 'xhigh' },
    ])
    await openPreview(wrapper)
    const dots = wrapper.findAll('.composer-step-dot')
    expect(dots.slice(2).every(dot => (dot.element as HTMLButtonElement).disabled)).toBe(true)
  })
  it.each([
    { source: 'cli', agent: 'hermes', codingAgentId: undefined },
    { source: 'coding_agent', agent: 'codex', codingAgentId: 'codex' },
    { source: 'coding_agent', agent: 'pi', codingAgentId: 'pi' },
    { model: 'unknown-capabilities' },
  ])('does not offer an empty Fast toggle for an unsupported model or engine', async patch => {
    const { wrapper } = setup(steps, patch)
    await openPreview(wrapper)
    expect(disabled(wrapper, '.composer-fast-toggle')).toBe(true)
  })
  it('restores the opening Fast draft when returning to the original model without committing intermediate changes', async () => {
    const { wrapper, chat } = setup(steps, { fastMode: true })
    await openPreview(wrapper)
    await wrapper.findAll('.composer-step-dot')[1].trigger('click')
    expect(wrapper.get('.composer-fast-toggle').attributes('aria-pressed')).toBe('false')
    await wrapper.findAll('.composer-step-dot')[0].trigger('click')
    expect(wrapper.get('.composer-fast-toggle').attributes('aria-pressed')).toBe('true')
    await closeOutside()
    expect(chat.setSessionFastMode).not.toHaveBeenCalled()
    expect(chat.applyModelPreset).not.toHaveBeenCalled()
  })
  it('resets draft Fast when preview model changes, without touching real settings until close', async () => {
    const { wrapper, chat } = setup(steps, { fastMode: true })
    await openPreview(wrapper)
    await wrapper.findAll('.composer-step-dot')[1].trigger('click')
    expect(wrapper.get('.composer-fast-toggle').attributes('aria-pressed')).toBe('false')
    expect(chat.activeSession?.fastMode).toBe(true)
    await closeOutside()
    expect(chat.activeSession?.fastMode).toBe(false)
  })
  it('discards draft and pending close when switching sessions', async () => {
    vi.useFakeTimers()
    const { wrapper, chat } = setup()
    await openPreview(wrapper)
    await wrapper.findAll('.composer-step-dot')[1].trigger('click')
    await wrapper.get('.composer-control').trigger('mouseleave')
    chat.activeSessionId = 'another-session'
    await nextTick()
    expect(chat.applyModelPreset).not.toHaveBeenCalled()
    expect(wrapper.find('.composer-model-bar').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(120)
    expect(chat.applyModelPreset).not.toHaveBeenCalled()
    expect(chat.setSessionFastMode).not.toHaveBeenCalled()
  })
  it('keeps the current stream alive and changes settings only on close', async () => {
    const { wrapper, chat } = setup()
    chat.isStreaming = true
    await openPreview(wrapper)
    await wrapper.findAll('.composer-step-dot')[1].trigger('click')
    expect(wrapper.text()).toContain('composer.nextMessage')
    expect(chat.activeSession?.model).toBe('fast-model')
    await closeOutside()
    expect(chat.isStreaming).toBe(true)
    expect(chat.stopStreaming).not.toHaveBeenCalled()
    expect(chat.activeSession?.model).toBe('deep-model')
  })
  it('reset previews the configured default without applying it immediately', async () => {
    const { wrapper, chat } = setup()
    await openPreview(wrapper)
    await wrapper.get('.composer-reset').trigger('click')
    expect(wrapper.get('.composer-step-label').text()).toBe('Deep')
    expect(chat.applyModelPreset).not.toHaveBeenCalled()
    await closeOutside()
    expect(chat.applyModelPreset).toHaveBeenCalledTimes(1)
  })
})

describe('configured model combinations only', () => {
  it('never invents reasoning steps when the preset list is empty', async () => {
    const { wrapper, chat } = setup([])
    await openPreview(wrapper)
    expect(wrapper.find('.composer-step-slider').exists()).toBe(false)
    expect(wrapper.findAll('.composer-step-dot')).toHaveLength(0)
    expect(wrapper.get('[data-testid="preset-empty"]').text()).toContain('composer.noPresets')
    await closeOutside()
    expect(chat.applyModelPreset).not.toHaveBeenCalled()
  })
  it('preserves an open order snapshot if the editor reorders or removes presets elsewhere', async () => {
    const { wrapper, chat, config } = setup()
    await openPreview(wrapper)
    await wrapper.findAll('.composer-step-dot')[1].trigger('click')
    config.hydrate('default', { composer_steps: [steps[0]], composer_default_step_id: steps[0].id })
    expect(wrapper.findAll('.composer-step-dot')).toHaveLength(2)
    await closeOutside()
    expect(error).toHaveBeenCalledWith('composer.presetChanged')
    expect(chat.applyModelPreset).not.toHaveBeenCalled()
  })
})
