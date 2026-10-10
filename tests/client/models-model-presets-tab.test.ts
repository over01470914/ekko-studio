// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, onMounted, onUnmounted, reactive } from 'vue'

enableAutoUnmount(afterEach)
const state = vi.hoisted(() => ({ route: null as any, models: null as any, profiles: null as any,
  replace: vi.fn(), fetchProviders: vi.fn(), reloadModels: vi.fn(), checkToken: vi.fn(),
  mounts: vi.fn(), unmounts: vi.fn(),
}))
vi.mock('vue-router', () => ({ useRoute: () => state.route, useRouter: () => ({ replace: state.replace }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/hermes/models', () => ({ useModelsStore: () => state.models }))
vi.mock('@/stores/hermes/app', () => ({ useAppStore: () => ({ reloadModels: state.reloadModels }) }))
vi.mock('@/stores/hermes/profiles', () => ({ useProfilesStore: () => state.profiles }))
vi.mock('@/api/hermes/profiles', () => ({ fetchProfiles: async () => [{ name: 'default' }, { name: 'work' }] }))
vi.mock('@/api/hermes/copilot-auth', () => ({ checkCopilotToken: state.checkToken }))
vi.mock('@/components/common/PageLoading.vue', () => ({ default: defineComponent({
  name: 'PageLoading', props: ['show'], setup: (props, { slots }) => () => h('main', { 'data-loading': String(props.show) }, slots.default?.()),
}) }))
vi.mock('@/components/layout/PageHeader.vue', () => ({ default: { template: '<div><slot /></div>' } }))
vi.mock('@/components/hermes/models/ModelPresetsPanel.vue', () => ({ default: defineComponent({
  name: 'ModelPresetsPanel', props: ['profile', 'groups', 'providersLoading'], setup(props) {
    onMounted(() => state.mounts(props.profile))
    onUnmounted(() => state.unmounts(props.profile))
    return () => h('div', { 'data-testid': 'panel-stub', 'data-profile': props.profile })
  },
}) }))
vi.mock('@/components/hermes/models/ProvidersPanel.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/hermes/models/AuxiliaryModelsPanel.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/hermes/models/CombinationModelsPanel.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/hermes/models/JevSettingsPanel.vue', () => ({ default: { props: ['profile'], template: '<div />' } }))
vi.mock('@/components/hermes/settings/VoiceSettings.vue', () => ({ default: { props: ['kind'], template: '<div />' } }))
vi.mock('@/components/hermes/models/ProviderFormModal.vue', () => ({ default: { name: 'ProviderFormModal', emits: ['saved', 'close'], template: '<div data-testid="provider-modal" />' } }))
vi.mock('naive-ui', () => ({
  useMessage: () => ({ success: vi.fn(), error: vi.fn() }),
  NButton: defineComponent({ props: ['disabled'], emits: ['click'], setup: (props, { slots, emit }) => () => h('button', { disabled: props.disabled, onClick: () => emit('click') }, slots.default?.()) }),
  NSelect: defineComponent({ name: 'NSelect', props: ['value', 'options', 'disabled', 'loading'], emits: ['update:value'], setup: () => () => h('select') }),
  // Deliberately render even inactive pane slots: the view must own lazy panel mounting.
  NTabPane: defineComponent({ props: ['name', 'tab'], setup: (props, { slots }) => () => h('section', { 'data-tab': props.name, 'data-title': props.tab }, slots.default?.()) }),
  NTabs: defineComponent({ name: 'NTabs', props: ['value'], emits: ['update:value'], setup: (_, { slots }) => () => h('div', slots.default?.()) }),
}))
import ModelsView from '@/views/hermes/ModelsView.vue'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}
async function render(query: Record<string, string> = {}) {
  state.route.query = query
  const wrapper = mount(ModelsView)
  await flushPromises()
  await vi.dynamicImportSettled()
  await flushPromises()
  return wrapper
}
async function selectTab(wrapper: any, tab: string) {
  wrapper.getComponent({ name: 'NTabs' }).vm.$emit('update:value', tab)
  await flushPromises()
  await vi.dynamicImportSettled()
  await flushPromises()
}
describe('Models Model Presets tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.route = reactive({ query: {} })
    state.models = reactive({ providers: [], providersProfile: '', loading: false, refreshingModelCache: false,
      fetchProviders: state.fetchProviders, refreshModelCache: vi.fn() })
    state.profiles = reactive({ activeProfileName: 'default', switchProfile: vi.fn() })
    state.replace.mockImplementation(async ({ query }) => { state.route.query = query })
    state.checkToken.mockResolvedValue(undefined)
    state.fetchProviders.mockImplementation(async () => {
      state.models.providers = [{ provider: state.route.query.modelProfile, label: 'Selected', models: ['think'] }]
      state.models.providersProfile = state.route.query.modelProfile
    })
    state.reloadModels.mockResolvedValue(undefined)
  })

  it('registers the translated sibling tab without mounting its editor on General', async () => {
    const wrapper = await render()
    expect(wrapper.get('[data-tab="model-presets"]').attributes('data-title')).toBe('composer.modelPresetsTitle')
    expect(wrapper.findAll('[data-tab]').map(pane => pane.attributes('data-tab'))).toEqual(['general', 'auxiliary', 'combination', 'jev', 'stt', 'tts', 'model-presets'])
    expect(wrapper.find('[data-testid="panel-stub"]').exists()).toBe(false)
    expect(state.mounts).not.toHaveBeenCalled()
    expect(wrapper.find('[data-tab="general"] [data-tab="model-presets"]').exists()).toBe(false)
    await selectTab(wrapper, 'model-presets')
    expect(state.replace).toHaveBeenLastCalledWith({ query: { modelProfile: 'default', tab: 'model-presets' } })
    expect(state.mounts).toHaveBeenCalledExactlyOnceWith('default')
    await selectTab(wrapper, 'tts')
    expect(wrapper.find('[data-testid="panel-stub"]').exists()).toBe(false)
    expect(state.unmounts).toHaveBeenCalledExactlyOnceWith('default')
    await selectTab(wrapper, 'model-presets')
    expect(state.mounts).toHaveBeenCalledTimes(2)
  })

  it('accepts a preset deep link and passes the selected Models Profile catalog, not the active chat Profile', async () => {
    const wrapper = await render({ tab: 'model-presets', modelProfile: 'work' })
    const panel = wrapper.getComponent({ name: 'ModelPresetsPanel' })
    expect(wrapper.getComponent({ name: 'NTabs' }).props('value')).toBe('model-presets')
    expect(panel.props('profile')).toBe('work')
    expect(panel.props('groups')).toEqual(state.models.providers)
    expect(panel.props('groups')[0].provider).toBe('work')
    expect(state.profiles.activeProfileName).toBe('default')
    expect(state.profiles.switchProfile).not.toHaveBeenCalled()
    state.models.loading = true
    await flushPromises()
    expect(panel.props('providersLoading')).toBe(true)
    // Preset loading has no new registration in the Models Provider/OAuth loading chain.
    expect(wrapper.get('main').attributes('data-loading')).toBe('false')
  })

  it('uses the existing top Profile selector and does not mount against a previous Profile catalog during reload', async () => {
    const wrapper = await render({ tab: 'model-presets', modelProfile: 'default' })
    const pending = deferred()
    state.fetchProviders.mockImplementationOnce(async () => {
      await pending.promise
      state.models.providers = [{ provider: 'work', label: 'Work', models: ['second'] }]
      state.models.providersProfile = 'work'
    })
    wrapper.getComponent({ name: 'NSelect' }).vm.$emit('update:value', 'work')
    await flushPromises()
    expect(state.replace).toHaveBeenLastCalledWith({ query: { tab: 'model-presets', modelProfile: 'work' } })
    expect(wrapper.find('[data-testid="panel-stub"]').exists()).toBe(false)
    expect(wrapper.get('main').attributes('data-loading')).toBe('true')
    pending.resolve()
    await flushPromises()
    const panel = wrapper.getComponent({ name: 'ModelPresetsPanel' })
    expect(panel.props('profile')).toBe('work')
    expect(panel.props('groups')[0].provider).toBe('work')
    expect(state.mounts.mock.calls.map(call => call[0])).toEqual(['default', 'work'])
    expect(state.profiles.activeProfileName).toBe('default')
    expect(state.profiles.switchProfile).not.toHaveBeenCalled()
  })

  it('never passes a stale other-Profile provider catalog when the selected fetch fails', async () => {
    state.models.providers = [{ provider: 'default-only', label: 'Old profile', models: ['old-model'] }]
    state.models.providersProfile = 'default'
    state.fetchProviders.mockResolvedValueOnce(undefined)
    const wrapper = await render({ tab: 'model-presets', modelProfile: 'work' })
    const panel = wrapper.getComponent({ name: 'ModelPresetsPanel' })
    expect(panel.props('profile')).toBe('work')
    expect(panel.props('groups')).toEqual([])
    expect(state.profiles.activeProfileName).toBe('default')
  })

  it('keeps the Provider/OAuth startup chain unchanged and does not mount before it finishes', async () => {
    const token = deferred()
    state.checkToken.mockReturnValueOnce(token.promise)
    state.route.query = { tab: 'model-presets', modelProfile: 'work' }
    const wrapper = mount(ModelsView)
    await flushPromises()
    expect(state.fetchProviders).not.toHaveBeenCalled()
    expect(state.mounts).not.toHaveBeenCalled()
    expect(wrapper.get('main').attributes('data-loading')).toBe('true')
    token.resolve()
    await flushPromises()
    expect(state.fetchProviders).toHaveBeenCalledOnce()
    expect(state.mounts).toHaveBeenCalledExactlyOnceWith('work')
  })

  it('preserves addProvider override and OAuth refresh behavior with no preset editor mount', async () => {
    const wrapper = await render({ tab: 'model-presets', addProvider: '1', modelProfile: 'work' })
    expect(wrapper.getComponent({ name: 'NTabs' }).props('value')).toBe('general')
    expect(state.mounts).not.toHaveBeenCalled()
    vi.clearAllMocks()
    wrapper.getComponent({ name: 'ProviderFormModal' }).vm.$emit('saved')
    await flushPromises()
    expect(state.fetchProviders).toHaveBeenCalledOnce()
    expect(state.reloadModels).toHaveBeenCalledWith({ preserveSelection: true })
    expect(wrapper.find('[data-testid="provider-modal"]').exists()).toBe(false)
  })

  it.each([['stt', 'stt'], ['tts', 'tts'], ['fallback', 'auxiliary'], ['invalid', 'general']])('preserves query tab normalization for %s', async (queryTab, expected) => {
    const wrapper = await render({ tab: queryTab })
    expect(wrapper.getComponent({ name: 'NTabs' }).props('value')).toBe(expected)
    expect(state.mounts).not.toHaveBeenCalled()
  })
})
