// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, reactive } from 'vue'
import type { ModelPresetSettings } from '@/types/model-presets'

enableAutoUnmount(afterEach)
import type { AvailableModelGroup } from '@/api/hermes/system'

const state = vi.hoisted(() => ({
  store: null as any, groups: [] as AvailableModelGroup[],
  load: vi.fn(), save: vi.fn(), message: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/stores/hermes/model-presets', () => ({ useModelPresetsStore: () => state.store }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('naive-ui', () => ({
  useMessage: () => state.message,
  NButton: defineComponent({
    props: ['disabled', 'loading', 'type', 'size'], emits: ['click'],
    setup(props, { slots, emit }) {
      return () => h('button', { disabled: props.disabled || props.loading, onClick: () => emit('click') }, slots.default?.())
    },
  }),
  NInput: defineComponent({
    props: ['value', 'disabled', 'status'], emits: ['update:value'],
    setup(props, { emit }) {
      return () => h('input', { value: props.value, disabled: props.disabled,
        onInput: (event: Event) => emit('update:value', (event.target as HTMLInputElement).value) })
    },
  }),
  NSelect: defineComponent({
    props: ['value', 'options', 'disabled'], emits: ['update:value'],
    setup(props, { emit }) {
      return () => h('select', { value: props.value, disabled: props.disabled,
        onChange: (event: Event) => emit('update:value', (event.target as HTMLSelectElement).value) },
      (props.options.some((option: any) => option.value === '') ? props.options : [{ value: '', label: '' }, ...props.options]).map((option: any) => h('option', { value: option.value, disabled: option.disabled }, option.label)))
    },
  }),
  NAlert: defineComponent({ props: ['type', 'showIcon'], setup: (_, { slots }) => () => h('aside', slots.default?.()) }),
  NTag: defineComponent({ props: ['type'], setup: (_, { slots }) => () => h('span', slots.default?.()) }),
}))

import ModelPresetsPanel from '@/components/hermes/models/ModelPresetsPanel.vue'
const base = { id: 'work', label: 'Work', providerId: 'work', modelId: 'think', reasoningLevel: 'high' }
const saved = (): ModelPresetSettings => ({ presets: [{ ...base }], defaultPresetId: base.id })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function render(settings = saved(), profile = 'work') {
  state.store.byProfile[profile] = settings
  const wrapper = mount(ModelPresetsPanel, { props: { profile, groups: state.groups } })
  await flushPromises()
  return wrapper
}
const rows = (wrapper: any) => wrapper.findAll('[data-testid="composer-step"]')
const names = (wrapper: any) => rows(wrapper).map((row: any) => row.get('[data-testid="composer-name"]').element.value)

describe('ModelPresetsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.store = reactive({
      byProfile: {} as Record<string, ModelPresetSettings>, loading: {}, saving: {}, errors: {},
      get: (profile: string) => state.store.byProfile[profile] || { presets: [], defaultPresetId: '' },
      hasLoaded: (profile: string) => !!state.store.byProfile[profile],
      load: state.load, save: state.save,
    })
    state.load.mockResolvedValue(true)
    state.save.mockImplementation(async (profile, settings) => { state.store.byProfile[profile] = settings })
    state.groups = [
      { provider: 'work', label: 'Work', models: ['think', 'plain', 'unknown', 'disabled'], model_meta: {
        think: { reasoning: true, reasoning_efforts: ['low', 'high'], fast_mode: true }, plain: { reasoning: false },
        disabled: { disabled: true },
      } },
      { provider: 'other', label: 'Other', models: ['second'], model_meta: { second: { reasoning_efforts: ['medium'] } } },
    ] as AvailableModelGroup[]
  })

  it('loads a Profile cache with its explicit default, without saving or repeating the tab title', async () => {
    const wrapper = await render()
    expect(names(wrapper)).toEqual(['Work'])
    expect(wrapper.get('[data-testid="composer-default"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="composer-default"]').text()).toBe('composer.newChatDefault')
    expect(wrapper.get('[data-testid="composer-preview"]').text()).toContain('Work · think · high')
    expect(wrapper.find('h4').exists()).toBe(false)
    expect(state.load).toHaveBeenCalledExactlyOnceWith('work', { force: false })
    expect(state.save).not.toHaveBeenCalled()
  })

  it('edits, adds a blank model combination, sorts and saves only to the selected Profile store', async () => {
    const wrapper = await render()
    await wrapper.get('[data-testid="composer-add"]').trigger('click')
    let list = rows(wrapper)
    expect(list[1].get('[data-testid="composer-provider"]').element).toHaveProperty('value', '')
    expect(list[1].get('[data-testid="composer-model"]').element).toHaveProperty('value', '')
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    expect(state.save).not.toHaveBeenCalled()
    await list[1].get('[data-testid="composer-name"]').setValue('Quick')
    await list[1].get('[data-testid="composer-provider"]').setValue('work')
    expect(list[1].get('[data-testid="composer-model"]').element).toHaveProperty('value', '')
    await list[1].get('[data-testid="composer-model"]').setValue('plain')
    const id = list[1].attributes('data-preset-id')
    await list[1].get('[data-testid="composer-default"]').trigger('click')
    await list[1].get('[data-testid="composer-up"]').trigger('click')
    expect(names(wrapper)).toEqual(['Quick', 'Work'])
    expect(rows(wrapper)[0].attributes('data-preset-id')).toBe(id)
    await rows(wrapper)[0].get('[data-testid="composer-down"]').trigger('click')
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    await flushPromises()
    expect(state.save).toHaveBeenCalledWith('work', { presets: [{ ...base }, { id, label: 'Quick', providerId: 'work', modelId: 'plain' }], defaultPresetId: id })
    expect(state.message.success).toHaveBeenCalledWith('composer.saved')
  })

  it('allows several presets using the same model and keeps IDs/default stable during handle drag', async () => {
    const wrapper = await render({ presets: [{ ...base }, { ...base, id: 'second', label: 'Second' }, { ...base, id: 'third', label: 'Third', reasoningLevel: 'low' }], defaultPresetId: 'work' })
    const transfer = { setData: vi.fn(), effectAllowed: '' }
    await rows(wrapper)[0].get('[data-testid="composer-drag-handle"]').trigger('dragstart', { dataTransfer: transfer })
    expect(transfer.setData).toHaveBeenCalledWith('text/plain', 'work')
    await rows(wrapper)[2].trigger('drop')
    expect(names(wrapper)).toEqual(['Second', 'Third', 'Work'])
    expect(rows(wrapper)[2].attributes('data-preset-id')).toBe('work')
    expect(rows(wrapper)[2].get('[data-testid="composer-default"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    await flushPromises()
    expect(state.save.mock.calls[0][1].presets.map((step: any) => step.id)).toEqual(['second', 'third', 'work'])
    expect(state.save.mock.calls[0][1].defaultPresetId).toBe('work')
  })

  it('does not let field text initiate dragging or accept unrelated external drops', async () => {
    const wrapper = await render({ presets: [{ ...base }, { ...base, id: 'second', label: 'Second' }], defaultPresetId: 'work' })
    const event = new Event('dragstart', { bubbles: true, cancelable: true })
    rows(wrapper)[0].get('[data-testid="composer-name"]').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(rows(wrapper)[0].attributes('draggable')).toBeUndefined()
    await rows(wrapper)[1].trigger('drop', { dataTransfer: { getData: () => 'work' } })
    expect(names(wrapper)).toEqual(['Work', 'Second'])
  })

  it('keeps missing/disabled providers and models editable but blocks invalid saves', async () => {
    const wrapper = await render({ presets: [{ ...base, providerId: 'deleted' }, { ...base, id: 'gone', modelId: 'deleted' }, { ...base, id: 'disabled', modelId: 'disabled' }], defaultPresetId: '' })
    expect(rows(wrapper)).toHaveLength(3)
    expect(wrapper.findAll('[data-testid="composer-issue"]')).toHaveLength(3)
    expect(rows(wrapper)[0].get('[data-testid="composer-provider"]').element).toHaveProperty('value', 'deleted')
    expect(rows(wrapper)[1].get('[data-testid="composer-model"]').element).toHaveProperty('value', 'deleted')
    await rows(wrapper)[0].get('[data-testid="composer-name"]').setValue('Repair later')
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    expect(state.save).not.toHaveBeenCalled()
    expect(state.message.error).toHaveBeenCalledWith('composer.invalidModel')
  })

  it.each(['plain', 'unknown'])('retains invalid reasoning for %s without synthesizing fallback capabilities', async modelId => {
    const wrapper = await render({ presets: [{ ...base, modelId }], defaultPresetId: '' })
    const select = wrapper.get('[data-testid="composer-reasoning"]')
    expect(select.findAll('option').map(option => option.attributes('value'))).toEqual(['', 'high'])
    expect(select.element).toHaveProperty('value', 'high')
    expect(wrapper.get('[data-testid="composer-issue"]').text()).toContain('(high)')
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    expect(state.message.error).toHaveBeenCalledWith('composer.invalidReasoning')
    expect(state.save).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="composer-issue"] button').trigger('click')
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    await flushPromises()
    expect(state.save).toHaveBeenCalledWith('work', { presets: [{ id: base.id, label: base.label, providerId: base.providerId, modelId }], defaultPresetId: '' })
  })

  it('clears reasoning on explicit provider/model changes and requires explicit model choice', async () => {
    const wrapper = await render()
    await wrapper.get('[data-testid="composer-provider"]').setValue('other')
    expect(wrapper.get('[data-testid="composer-model"]').element).toHaveProperty('value', '')
    expect(wrapper.get('[data-testid="composer-reasoning"]').element).toHaveProperty('value', '')
    await wrapper.get('[data-testid="composer-model"]').setValue('second')
    expect(wrapper.get('[data-testid="composer-reasoning"]').findAll('option').map(option => option.attributes('value'))).toEqual(['', 'medium'])
    await wrapper.get('[data-testid="composer-reasoning"]').setValue('medium')
    await wrapper.get('[data-testid="composer-provider"]').setValue('work')
    await wrapper.get('[data-testid="composer-model"]').setValue('think')
    await wrapper.get('[data-testid="composer-reasoning"]').setValue('high')
    await wrapper.get('[data-testid="composer-model"]').setValue('plain')
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    await flushPromises()
    expect(state.save.mock.calls[0][1].presets[0]).toEqual({ id: base.id, label: base.label, providerId: 'work', modelId: 'plain' })
  })

  it('adds stable IDs without secure-context randomUUID and does not auto-select a default', async () => {
    const originalCrypto = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto) })
    try {
      const wrapper = await render({ presets: [], defaultPresetId: '' })
      await wrapper.get('[data-testid="composer-add"]').trigger('click')
      expect(rows(wrapper)[0].attributes('data-preset-id')).toMatch(/^[0-9a-f-]{36}$/)
      expect(wrapper.get('[data-testid="composer-default"]').attributes('aria-pressed')).toBe('false')
    } finally { vi.unstubAllGlobals() }
  })

  it('validates blank names before normalization can drop a row', async () => {
    const wrapper = await render()
    await wrapper.get('[data-testid="composer-name"]').setValue(' ')
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    expect(state.save).not.toHaveBeenCalled()
    expect(rows(wrapper)).toHaveLength(1)
    expect(state.message.error).toHaveBeenCalledWith('composer.saveFailed')
  })

  it('deletes the default without promoting another model and respects the 12-preset limit', async () => {
    const wrapper = await render({ presets: Array.from({ length: 12 }, (_, i) => ({ ...base, id: String(i) })), defaultPresetId: '0' })
    expect(wrapper.get('[data-testid="composer-add"]').attributes('disabled')).toBeDefined()
    await rows(wrapper)[0].get('[data-testid="composer-remove"]').trigger('click')
    expect(wrapper.findAll('[data-testid="composer-default"]').every(button => button.attributes('aria-pressed') === 'false')).toBe(true)
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    await flushPromises()
    expect(state.save.mock.calls[0][1].defaultPresetId).toBe('')
    expect(state.save.mock.calls[0][1].presets).toHaveLength(11)
  })

  it('allows explicitly clearing/reassigning the default and clears it with the last preset', async () => {
    const wrapper = await render()
    await wrapper.get('[data-testid="composer-clear-default"]').trigger('click')
    expect(wrapper.get('[data-testid="composer-default"]').attributes('aria-pressed')).toBe('false')
    await wrapper.get('[data-testid="composer-default"]').trigger('click')
    expect(wrapper.get('[data-testid="composer-default"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('[data-testid="composer-remove"]').trigger('click')
    expect(wrapper.get('[data-testid="composer-empty"]').text()).toBe('composer.empty')
    expect(wrapper.text()).toContain('composer.fastModeHint')
    expect(wrapper.text()).toContain('composer.fastModeCostHint')
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    await flushPromises()
    expect(state.save).toHaveBeenCalledWith('work', { presets: [], defaultPresetId: '' })
  })

  it('persists an explicitly cleared default without deleting or replacing the model', async () => {
    const wrapper = await render()
    await wrapper.get('[data-testid="composer-clear-default"]').trigger('click')
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    await flushPromises()
    expect(state.save).toHaveBeenCalledWith('work', { presets: [{ ...base }], defaultPresetId: '' })
  })

  it('keeps an independent draft, ignores cache/catalog updates, and resets to current saved configuration', async () => {
    const wrapper = await render()
    await wrapper.get('[data-testid="composer-name"]').setValue('Local')
    expect(state.store.get('work').presets[0].label).toBe('Work')
    state.store.byProfile.work = { presets: [{ ...base, label: 'Saved elsewhere' }], defaultPresetId: '' }
    await wrapper.setProps({ groups: [...state.groups] })
    expect(names(wrapper)).toEqual(['Local'])
    expect(state.load).toHaveBeenCalledTimes(1)
    await wrapper.get('[data-testid="composer-reset"]').trigger('click')
    expect(names(wrapper)).toEqual(['Saved elsewhere'])
    expect(wrapper.get('[data-testid="composer-default"]').attributes('aria-pressed')).toBe('false')
  })

  it('reports save failure without losing draft and lets the user retry', async () => {
    state.save.mockRejectedValueOnce(new Error('failed'))
    const wrapper = await render()
    await wrapper.get('[data-testid="composer-name"]').setValue('Edited')
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    await flushPromises()
    expect(state.message.error).toHaveBeenCalledWith('composer.saveFailed')
    expect(names(wrapper)).toEqual(['Edited'])
    expect(state.store.get('work').presets[0].label).toBe('Work')
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    await flushPromises()
    expect(state.save).toHaveBeenCalledTimes(2)
    expect(state.save.mock.calls[1][1].presets[0].label).toBe('Edited')
  })

  it('gates pending load, handles failure/retry, and never saves an unhydrated empty draft', async () => {
    const pending = deferred<boolean>()
    state.load.mockReturnValueOnce(pending.promise)
    const wrapper = mount(ModelPresetsPanel, { props: { profile: 'work', groups: state.groups } })
    expect(wrapper.get('[data-testid="composer-add"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="composer-save"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="composer-empty"]').exists()).toBe(false)
    pending.resolve(false)
    await flushPromises()
    expect(wrapper.find('[data-testid="composer-load-error"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="composer-save"]').attributes('disabled')).toBeDefined()
    state.load.mockImplementationOnce(async () => { state.store.byProfile.work = saved(); return true })
    await wrapper.get('[data-testid="composer-retry"]').trigger('click')
    await flushPromises()
    expect(state.load).toHaveBeenLastCalledWith('work', { force: true })
    expect(names(wrapper)).toEqual(['Work'])
    expect(wrapper.find('[data-testid="composer-load-error"]').exists()).toBe(false)
  })

  it('gates all editing for provider loading, store loading, save and empty selected Profile', async () => {
    const wrapper = await render()
    const assertBlocked = () => {
      for (const selector of ['composer-add', 'composer-remove', 'composer-default', 'composer-reset', 'composer-save', 'composer-drag-handle', 'composer-name', 'composer-provider', 'composer-model', 'composer-reasoning']) {
        expect(wrapper.get('[data-testid="' + selector + '"]').attributes('disabled'), selector).toBeDefined()
      }
    }
    await wrapper.setProps({ providersLoading: true })
    assertBlocked()
    await wrapper.setProps({ providersLoading: false })
    state.store.loading.work = true
    await flushPromises()
    assertBlocked()
    state.store.loading.work = false
    await flushPromises()
    const pending = deferred<void>()
    state.save.mockReturnValueOnce(pending.promise)
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    assertBlocked()
    pending.resolve()
    await flushPromises()
    await wrapper.setProps({ profile: '' })
    expect(wrapper.get('[data-testid="composer-add"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="composer-save"]').attributes('disabled')).toBeDefined()
    expect(state.load).toHaveBeenCalledTimes(1)
  })

  it('ignores the previous Profile late load and mounts only the new Profile cache', async () => {
    const pending = deferred<boolean>()
    state.load.mockReturnValueOnce(pending.promise)
    const wrapper = mount(ModelPresetsPanel, { props: { profile: 'work', groups: state.groups } })
    state.store.byProfile.research = { presets: [{ ...base, id: 'research', label: 'Research' }], defaultPresetId: '' }
    await wrapper.setProps({ profile: 'research' })
    await flushPromises()
    expect(names(wrapper)).toEqual(['Research'])
    state.store.byProfile.work = saved()
    pending.resolve(true)
    await flushPromises()
    expect(names(wrapper)).toEqual(['Research'])
    expect(state.load.mock.calls.map(call => call[0])).toEqual(['work', 'research'])
  })

  it.each(['success', 'failure'])('does not let a late save %s overwrite or lock the new Profile draft', async outcome => {
    const pending = deferred<void>()
    state.save.mockReturnValueOnce(pending.promise)
    const wrapper = await render()
    await wrapper.get('[data-testid="composer-name"]').setValue('Old draft')
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    state.store.byProfile.research = { presets: [{ ...base, id: 'research', label: 'Research' }], defaultPresetId: '' }
    await wrapper.setProps({ profile: 'research' })
    await flushPromises()
    await wrapper.get('[data-testid="composer-name"]').setValue('New draft')
    if (outcome === 'success') pending.resolve()
    else pending.reject(new Error('failed'))
    await flushPromises()
    expect(names(wrapper)).toEqual(['New draft'])
    expect(wrapper.get('[data-testid="composer-save"]').attributes('disabled')).toBeUndefined()
    expect(state.message.success).not.toHaveBeenCalled()
    expect(state.message.error).not.toHaveBeenCalled()
    expect(state.save.mock.calls[0][0]).toBe('work')
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    await flushPromises()
    expect(state.save.mock.calls[1][0]).toBe('research')
    expect(state.save.mock.calls[1][1].presets[0].label).toBe('New draft')
  })

  it('keeps a new Profile save locked when an older Profile save settles', async () => {
    const oldSave = deferred<void>()
    const newSave = deferred<void>()
    state.save.mockReturnValueOnce(oldSave.promise).mockReturnValueOnce(newSave.promise)
    const wrapper = await render()
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    state.store.byProfile.research = { presets: [{ ...base, label: 'Research' }], defaultPresetId: '' }
    await wrapper.setProps({ profile: 'research' })
    await flushPromises()
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    oldSave.resolve()
    await flushPromises()
    expect(wrapper.get('[data-testid="composer-save"]').attributes('disabled')).toBeDefined()
    expect(names(wrapper)).toEqual(['Research'])
    expect(state.message.success).not.toHaveBeenCalled()
    newSave.resolve()
    await flushPromises()
    expect(wrapper.get('[data-testid="composer-save"]').attributes('disabled')).toBeUndefined()
    expect(state.message.success).toHaveBeenCalledExactlyOnceWith('composer.saved')
  })

  it('does not emit late save notifications after leaving the tab', async () => {
    const pending = deferred<void>()
    state.save.mockReturnValueOnce(pending.promise)
    const wrapper = await render()
    await wrapper.get('[data-testid="composer-save"]').trigger('click')
    wrapper.unmount()
    pending.resolve()
    await flushPromises()
    expect(state.message.success).not.toHaveBeenCalled()
  })
})
