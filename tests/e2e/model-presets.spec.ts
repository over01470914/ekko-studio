import { expect, test, type Page, type Locator } from '@playwright/test'
import { authenticate, mockChatSocket, mockHermesApi, TEST_ACCESS_KEY, TEST_MODEL_GROUP } from './fixtures'
import type { ModelPreset } from '../../packages/client/src/types/model-presets'

const sessionId = 'composer-session'
const inputPlaceholder = 'Type a message... (Enter to send, Shift+Enter for new line)'
const presets: ModelPreset[] = [
  { id: 'quick', label: 'Quick', providerId: 'openai', modelId: 'fast-model', reasoningLevel: 'low' },
  { id: 'deep', label: 'Deep', providerId: 'other', modelId: 'deep-model', reasoningLevel: 'high' },
]
const modelGroups = [
  { ...TEST_MODEL_GROUP, provider: 'openai', label: 'OpenAI Test', models: ['fast-model', 'disabled-model', 'unknown-model', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'],
    available_models: ['fast-model', 'disabled-model', 'unknown-model', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'], model_meta: {
      'fast-model': { reasoning: true, reasoning_efforts: ['low', 'high'], fast_mode: true },
      'disabled-model': { disabled: true },
      'gpt-6-luna': { reasoning: true, reasoning_efforts: ['low', 'medium', 'high'], fast_mode: true },
      'gpt-6.1-sol': { reasoning: true, reasoning_efforts: ['low', 'medium', 'high'], fast_mode: true },
      'gpt-6-astra': { reasoning: true, reasoning_efforts: ['low', 'medium', 'high'], fast_mode: true },
    } },
  { ...TEST_MODEL_GROUP, provider: 'other', label: 'Other Test', models: ['deep-model'], available_models: ['deep-model'],
    model_meta: { 'deep-model': { reasoning: true, reasoning_efforts: ['high'], fast_mode: false } } },
]

async function setup(page: Page, steps = presets, sessionPatch: Record<string, unknown> = {}, activeProfile: 'default' | 'research' = 'default') {
  await authenticate(page, TEST_ACCESS_KEY, activeProfile)
  const session = { id: sessionId, profile: 'default', source: 'builtin_agent', agent: 'ekko-agent', agent_mode: 'scoped',
    model: 'fast-model', provider: 'openai', reasoning_effort: 'low', title: 'Composer test',
    started_at: 100, last_active: 101, message_count: 1, ...sessionPatch }
  const api = await mockHermesApi(page, { initialProfileName: activeProfile, sessions: [session], modelGroups })
  await mockChatSocket(page)
  const displays: Record<string, { streaming: boolean; show_reasoning: boolean; show_cost: boolean; composer_steps: ModelPreset[]; composer_default_step_id: string }> = {
    default: { streaming: true, show_reasoning: true, show_cost: true,
      composer_steps: steps.map(step => ({ ...step })), composer_default_step_id: steps.some(step => step.id === 'quick') ? 'quick' : '' },
    research: { streaming: true, show_reasoning: true, show_cost: true,
      composer_steps: [{ ...presets[1], id: 'research-deep', label: 'Research deep' }], composer_default_step_id: 'research-deep' },
  }
  const configReads: Array<{ profile: string; section: string | null }> = []
  const configWriteProfiles: string[] = []
  const configWrites: Array<Record<string, any>> = []
  const selectionWrites: Array<{ path: string; body: Record<string, any> }> = []
  // Overrides are installed after the fixture catch-all. No request reaches a real backend.
  await page.route(/[/]api[/]hermes[/]config(?:[?].*)?$/, async route => {
    const profile = route.request().headers()['x-hermes-profile'] || activeProfile
    if (route.request().method() === 'PUT') {
      configWriteProfiles.push(route.request().headers()['x-hermes-profile'])
      const body = route.request().postDataJSON()
      configWrites.push(body)
      if (body.section === 'display') displays[profile] = { ...displays[profile], ...body.values }
      await route.fulfill({ json: { success: true } })
    } else {
      const section = new URL(route.request().url()).searchParams.get('section')
      configReads.push({ profile: section === 'display' ? route.request().headers()['x-hermes-profile'] : profile, section })
      await route.fulfill({ json: section === 'display' ? { display: displays[profile] }
        : { display: displays[profile], agent: {}, memory: {}, session_reset: {}, privacy: {}, approvals: {} } })
    }
  })
  await page.route(/[/]api[/]studio[/]sessions[/][^/]+[/](?:model|reasoning-effort)(?:[?].*)?$/, async route => {
    selectionWrites.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() })
    await route.fulfill({ json: { success: true } })
  })
  await page.addInitScript(sid => {
    ;(window as any).__PW_CHAT_SOCKET_RESUMES__ = {
      [sid]: { session_id: sid, messages: [{ id: 1, role: 'user', content: 'Composer session ready', timestamp: 100 }],
        isWorking: false, events: [], queueLength: 0 },
    }
  }, sessionId)
  await page.goto('/#/hermes/session/' + sessionId)
  await expect(page.getByText('Composer session ready')).toBeVisible()
  await expect(page.locator('.input-model-button')).toBeVisible()
  await expect(page.locator('.reasoning-effort-button')).toBeVisible()
  await page.locator('.composer-launcher').hover()
  await expect(page.locator('.composer-model-bar')).toBeVisible()
  await expect(page.locator('.composer-step-dot')).toHaveCount(steps.length)
  return { api, configWrites, selectionWrites, configReads, configWriteProfiles, getDisplay: (profile = 'default') => displays[profile] }
}

function dot(page: Page, label: string) {
  return page.locator('.composer-step-dot').and(page.getByRole('button', { name: new RegExp('^' + label + ' ·') }))
}
async function closePreview(page: Page) {
  await page.mouse.move(2, 2)
  await expect(page.locator('.composer-model-bar')).toHaveCount(0)
  await expect(page.locator('.composer-launcher')).toBeEnabled()
}
async function send(page: Page, input: string, runIndex: number) {
  await closePreview(page)
  await page.getByPlaceholder(inputPlaceholder).fill(input)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__PW_CHAT_SOCKET__.emitted.filter((item: any) => item.event === 'run').length)).toBe(runIndex + 1)
  return page.evaluate(index => (window as any).__PW_CHAT_SOCKET__.emitted.filter((item: any) => item.event === 'run')[index].payload, runIndex)
}
async function choose(page: Page, select: Locator, name: string) {
  // Wait for the preceding select's exit animation before targeting another menu.
  await expect(page.locator('.n-base-select-option:visible')).toHaveCount(0)
  await select.click()
  await page.locator('.n-base-select-option:visible').getByText(name, { exact: true }).click()
  await expect(page.locator('.n-base-select-option:visible')).toHaveCount(0)
}

test('cross-model presets disable unavailable combinations and display the actual custom selection', async ({ page }, testInfo) => {
  const invalid: ModelPreset[] = [
    { id: 'missing', label: 'Missing', providerId: 'openai', modelId: 'missing-model' },
    { id: 'disabled', label: 'Disabled', providerId: 'openai', modelId: 'disabled-model' },
    { ...presets[0], id: 'bad-effort', label: 'Invalid effort', reasoningLevel: 'max' },
    { id: 'unknown', label: 'Unknown effort', providerId: 'openai', modelId: 'unknown-model', reasoningLevel: 'high' },
  ]
  const { api, selectionWrites } = await setup(page, [...presets, ...invalid], { reasoning_effort: 'high' })
  await expect(page.locator('.composer-step-label')).toHaveText('Custom')
  await expect(page.locator('.composer-model-name')).toContainText('fast-model')
  await expect(page.locator('.composer-model-selector')).toHaveAttribute('title', /fast-model.*High/i)
  await expect(page.locator('.composer-step-dot[aria-pressed="true"]')).toHaveCount(0)
  for (const step of invalid) await expect(dot(page, step.label)).toBeDisabled()
  await expect(dot(page, 'Deep')).toHaveAttribute('title', /other[/]deep-model.*High/i)
  await dot(page, 'Deep').click()
  await expect(page.locator('.composer-step-label')).toHaveText('Deep')
  await expect(dot(page, 'Deep')).toHaveAttribute('aria-pressed', 'true')
  expect(selectionWrites).toEqual([])
  await closePreview(page)
  await expect.poll(() => selectionWrites.length).toBe(2)
  expect(selectionWrites).toEqual([
    { path: '/api/studio/sessions/' + sessionId + '/model', body: { model: 'deep-model', provider: 'other' } },
    { path: '/api/studio/sessions/' + sessionId + '/reasoning-effort', body: { reasoningEffort: 'high' } },
  ])
  await page.locator('.composer-launcher').hover()
  await page.screenshot({ path: testInfo.outputPath('composer-model-bar.png') })
  expect(api.unexpectedRequests).toEqual([])
})

test('Fast is independent of reasoning; selecting the next model during streaming does not abort the active run', async ({ page }) => {
  const { api, selectionWrites } = await setup(page)
  const fast = page.locator('.composer-fast-toggle')
  await expect(fast).toBeEnabled()
  await fast.click()
  await expect(fast).toHaveAttribute('aria-pressed', 'true')
  await expect(dot(page, 'Quick')).toHaveAttribute('aria-pressed', 'true')
  expect(selectionWrites).toEqual([])
  const first = await send(page, 'Stream with Fast', 0)
  expect(first).toMatchObject({ model: 'fast-model', provider: 'openai', reasoning_effort: 'low', fast_mode: true })
  await page.evaluate(sid => {
    const socket = (window as any).__PW_CHAT_SOCKET__.latest
    socket.__trigger('run.started', { event: 'run.started', session_id: sid, run_id: 'stream-1' })
    socket.__trigger('message.delta', { event: 'message.delta', session_id: sid, run_id: 'stream-1', delta: 'Still streaming' })
  }, sessionId)
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await page.locator('.composer-launcher').hover()
  await expect(page.locator('.composer-next-message')).toHaveText('Applies to the next message')
  await dot(page, 'Deep').click()
  await expect(page.locator('.composer-step-label')).toHaveText('Deep')
  await expect(fast).toBeDisabled()
  await expect(fast).toHaveAttribute('aria-pressed', 'false')
  expect(selectionWrites).toEqual([])
  await closePreview(page)
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await page.evaluate(sid => {
    const socket = (window as any).__PW_CHAT_SOCKET__.latest
    socket.__trigger('message.delta', { event: 'message.delta', session_id: sid, run_id: 'stream-1', delta: ' after selection' })
  }, sessionId)
  await expect(page.getByText('Still streaming after selection')).toBeVisible()
  const second = await send(page, 'Use next preset', 1)
  expect(second).toMatchObject({ session_id: first.session_id, model: 'deep-model', provider: 'other', reasoning_effort: 'high' })
  expect(second.fast_mode).not.toBe(true)
  expect(await page.evaluate(() => (window as any).__PW_CHAT_SOCKET__.emitted.filter((item: any) => item.event === 'abort'))).toEqual([])
  const original = await page.evaluate(() => (window as any).__PW_CHAT_SOCKET__.emitted.find((item: any) => item.event === 'run').payload)
  expect(original).toEqual(first)
  await page.evaluate(sid => {
    (window as any).__PW_CHAT_SOCKET__.latest.__trigger('run.completed', { event: 'run.completed', session_id: sid,
      run_id: 'stream-1', output: 'Still streaming after selection', queue_remaining: 1 })
  }, sessionId)
  await expect(page.getByText('Still streaming after selection')).toBeVisible()
  expect(api.unexpectedRequests).toEqual([])
})

for (const [name, patch, enabled] of [
  ['scoped Codex', { source: 'coding_agent', agent: 'codex', agent_mode: 'scoped' }, false],
  ['Hermes', { source: 'cli', agent: null, agent_mode: null }, false],
  ['Pi', { source: 'coding_agent', agent: 'pi', agent_mode: 'scoped' }, false],
] as const) {
  test('Fast engine capability: ' + name, async ({ page }) => {
    const { api } = await setup(page, presets, patch)
    if (enabled) {
      await expect(page.locator('.composer-fast-toggle')).toBeEnabled()
      await page.locator('.composer-fast-toggle').click()
      await expect(page.locator('.composer-fast-toggle')).toHaveAttribute('aria-pressed', 'true')
      const run = await send(page, 'Fast capability', 0)
      expect(run).toMatchObject({ fast_mode: true, reasoning_effort: 'low' })
    } else {
      await expect(page.locator('.composer-fast-toggle')).toBeDisabled()
    }
    expect(api.unexpectedRequests).toEqual([])
  })
}

const realCombinations: ModelPreset[] = [
  { id: 'basic', label: 'basic', providerId: 'openai', modelId: 'gpt-6-luna', reasoningLevel: 'medium' },
  { id: 'default', label: 'default', providerId: 'openai', modelId: 'gpt-6.1-sol', reasoningLevel: 'low' },
  { id: 'deep', label: 'deep', providerId: 'openai', modelId: 'gpt-6.1-sol', reasoningLevel: 'high' },
  { id: 'extreme', label: 'extreme', providerId: 'openai', modelId: 'gpt-6-astra', reasoningLevel: 'medium' },
]

async function openManager(page: Page, profile = 'default') {
  await page.locator('.composer-manage').click()
  await expect(page).toHaveURL(new RegExp('hermes[/]models[?]tab=model-presets&modelProfile=' + profile))
  const panel = page.getByTestId('model-presets-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('composer-save')).toBeEnabled()
  return panel
}

async function rowIds(panel: Locator) {
  return panel.getByTestId('composer-step').evaluateAll(rows => rows.map(row => row.getAttribute('data-preset-id')))
}

test('Models has a sibling Model Presets tab; Settings Models no longer contains preset management', async ({ page }) => {
  // The active profile differs from the session: management must follow the session.
  const { api } = await setup(page, presets, {}, 'research')
  const panel = await openManager(page)
  await expect(page.getByTestId('models-profile-select')).toContainText('default')
  // Naive UI's line tabs expose CSS state, not ARIA tab roles.
  const tabs = page.locator('.models-content .n-tabs-nav')
  await expect(tabs.locator('.n-tabs-tab').filter({ hasText: /^Model Presets$/ })).toHaveClass(/n-tabs-tab--active/)
  await expect(tabs.locator('.n-tabs-tab').filter({ hasText: /^General Models$/ })).toBeVisible()
  await expect(tabs.locator('.n-tabs-tab').filter({ hasText: /^STT providers$/ })).toBeVisible()
  await expect(tabs.locator('.n-tabs-tab').filter({ hasText: /^TTS providers$/ })).toBeVisible()
  await expect(panel.getByTestId('composer-step')).toHaveCount(2)
  await page.goto('/#/hermes/settings?tab=models')
  await expect(page.locator('.settings-content .provider-name').filter({ hasText: 'OpenAI Test' })).toBeVisible()
  await expect(page.getByTestId('model-presets-panel')).toHaveCount(0)
  await expect(page.getByTestId('composer-steps-settings')).toHaveCount(0)
  await expect(page.getByTestId('composer-step')).toHaveCount(0)
  expect(api.unexpectedRequests).toEqual([])
})

test('edit and persist all four real combinations; reordered slider previews locally and commits only the final complete pair', async ({ page }, testInfo) => {
  // Keep all four editor rows in view so native drag/drop is not interrupted by nested auto-scroll.
  await page.setViewportSize({ width: 1280, height: 1600 })
  const { api, configWrites, configWriteProfiles, configReads, getDisplay, selectionWrites } = await setup(page, [])
  const panel = await openManager(page)
  const rows = panel.getByTestId('composer-step')
  for (const [index, preset] of realCombinations.entries()) {
    await panel.getByTestId('composer-add').click()
    const row = rows.nth(index)
    await row.getByTestId('composer-name').locator('input').fill(preset.label)
    await choose(page, row.getByTestId('composer-provider'), 'OpenAI Test')
    await choose(page, row.getByTestId('composer-model'), preset.modelId)
    await choose(page, row.getByTestId('composer-reasoning'), preset.reasoningLevel!)
  }
  const ids = await rowIds(panel)
  await rows.nth(1).getByTestId('composer-default').click()
  const defaultId = ids[1]
  // Native drag handle changes order without changing the identity of the default.
  await rows.nth(3).getByTestId('composer-drag-handle').dragTo(rows.nth(0).getByTestId('composer-drag-handle'))
  await expect.poll(() => rowIds(panel)).toEqual([ids[3], ids[0], ids[1], ids[2]])
  await rows.nth(2).getByTestId('composer-up').click()
  await expect.poll(() => rowIds(panel)).toEqual([ids[3], ids[1], ids[0], ids[2]])
  await rows.nth(1).getByTestId('composer-down').click()
  await expect.poll(() => rowIds(panel)).toEqual([ids[3], ids[0], ids[1], ids[2]])
  await expect(panel.locator('[data-preset-id="' + defaultId + '"]').getByTestId('composer-default')).toHaveAttribute('aria-pressed', 'true')
  await panel.getByTestId('composer-save').click()
  await expect(page.getByText('Model presets saved', { exact: true })).toBeVisible()
  expect(configWrites).toEqual([{ section: 'display', restart: false, values: {
    composer_steps: [3, 0, 1, 2].map(index => ({ ...realCombinations[index], id: ids[index] })),
    composer_default_step_id: defaultId,
  } }])
  expect(configWriteProfiles).toEqual(['default'])
  expect(getDisplay().composer_default_step_id).toBe(defaultId)
  // Startup whole-config hydration is reused, without an extra preset request.
  expect(configReads.filter(read => read.section === 'display')).toEqual([])
  await page.reload()
  // DOM readiness is not visual readiness: wait for the existing loading surface
  // to finish its paint/minimum-display interval before verifying the screenshot.
  await expect(page.getByTestId('model-presets-panel')).toBeVisible()
  await expect(page.getByTestId('model-presets-panel').getByTestId('composer-save')).toBeEnabled()
  await expect.poll(() => rowIds(page.getByTestId('model-presets-panel'))).toEqual([ids[3], ids[0], ids[1], ids[2]])
  // Reloaded startup settings already hydrate this Profile's cache; the editor
  // must not add a redundant display GET when the saved configuration is ready.
  expect(configReads.filter(read => read.section === 'display')).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('model-presets-four-combinations-editor.png'), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/#/hermes/session/' + sessionId)
  await page.reload()
  await expect(page.getByText('Composer session ready')).toBeVisible()
  await page.locator('.composer-launcher').hover()
  const ordered = [realCombinations[3], realCombinations[0], realCombinations[1], realCombinations[2]]
  await expect(page.locator('.composer-step-dot')).toHaveCount(4)
  await expect(page.locator('.composer-step-slider')).toHaveAttribute('max', '3')
  const originalEffort = await page.locator('.reasoning-effort-button').getAttribute('aria-label')
  for (const [index, preset] of ordered.entries()) {
    await expect(page.locator('.composer-step-dot').nth(index)).toHaveAttribute('title', new RegExp(preset.label + '.*openai[/]' + preset.modelId.replaceAll('.', '[.]') + '.*' + preset.reasoningLevel, 'i'))
    await page.locator('.composer-step-slider').fill(String(index))
    await expect(page.locator('.composer-step-label')).toHaveText(preset.label)
    await expect(page.locator('.composer-model-name')).toHaveText(preset.modelId)
    await expect(page.locator('.composer-effort-name')).toHaveText(new RegExp(preset.reasoningLevel!, 'i'))
    await expect(page.locator('.input-model-label')).toContainText('fast-model')
    await expect(page.locator('.reasoning-effort-button')).toHaveAttribute('aria-label', originalEffort!)
    expect(selectionWrites).toEqual([])
  }
  await page.screenshot({ path: testInfo.outputPath('model-presets-four-combinations-preview.png') })
  await closePreview(page)
  await expect.poll(() => selectionWrites.length).toBe(2)
  expect(selectionWrites.map(write => write.body)).toEqual([{ model: 'gpt-6.1-sol', provider: 'openai' }, { reasoningEffort: 'high' }])
  await expect(page.locator('.input-model-label')).toContainText('gpt-6.1-sol')
  await expect(page.locator('.reasoning-effort-button')).toHaveAttribute('aria-label', /high/i)
  // Reset previews the configured default, not the first item after reorder.
  await page.locator('.composer-launcher').hover()
  await page.locator('.composer-reset').click()
  await expect(page.locator('.composer-step-label')).toHaveText('default')
  await expect(page.locator('.composer-model-name')).toHaveText('gpt-6.1-sol')
  await expect(page.locator('.composer-effort-name')).toHaveText(/low/i)
  await closePreview(page)
  expect(api.unexpectedRequests).toEqual([])
})

test('deleting the default clears its stable ID without promoting or switching to another model', async ({ page }) => {
  const { api, configWrites, selectionWrites } = await setup(page)
  const panel = await openManager(page)
  await panel.getByTestId('composer-step').nth(0).getByTestId('composer-remove').click()
  await expect(panel.getByTestId('composer-default')).toHaveAttribute('aria-pressed', 'false')
  await panel.getByTestId('composer-save').click()
  await expect.poll(() => configWrites.length).toBe(1)
  expect(configWrites[0]).toEqual({ section: 'display', restart: false, values: { composer_steps: [presets[1]], composer_default_step_id: '' } })
  await page.goto('/#/hermes/session/' + sessionId)
  await page.reload()
  await expect(page.locator('.input-model-label')).toContainText('fast-model')
  await expect(page.locator('.reasoning-effort-button')).toHaveAttribute('aria-label', /low/i)
  await page.locator('.composer-launcher').hover()
  await expect(page.locator('.composer-reset')).toBeDisabled()
  await expect(page.locator('.composer-step-label')).toHaveText('Custom')
  await closePreview(page)
  expect(selectionWrites).toEqual([])
  expect(api.unexpectedRequests).toEqual([])
})

test('hover preview does not write until leaving and rapidly dragging only commits the final pair', async ({ page }) => {
  const { api, selectionWrites } = await setup(page)
  const originalEffort = await page.locator('.reasoning-effort-button').getAttribute('aria-label')
  const slider = page.locator('.composer-step-slider')
  await slider.fill('1')
  await slider.dispatchEvent('input')
  await expect(page.locator('.composer-step-label')).toHaveText('Deep')
  await expect(page.locator('.input-model-label')).toContainText('fast-model')
  await expect(page.locator('.reasoning-effort-button')).toHaveAttribute('aria-label', originalEffort!)
  expect(selectionWrites).toEqual([])
  await slider.fill('0')
  await slider.dispatchEvent('input')
  await slider.fill('1')
  await slider.dispatchEvent('input')
  expect(selectionWrites).toEqual([])
  await closePreview(page)
  await expect.poll(() => selectionWrites.length).toBe(2)
  await expect(page.locator('.input-model-label')).toContainText('deep-model')
  expect(selectionWrites.map(write => write.body)).toEqual([{ model: 'deep-model', provider: 'other' }, { reasoningEffort: 'high' }])
  expect(api.unexpectedRequests).toEqual([])
})


test('unchanged preview and reverting slider/Fast never writes', async ({ page }) => {
  const { api, selectionWrites } = await setup(page)
  await closePreview(page)
  expect(selectionWrites).toEqual([])
  await page.locator('.composer-launcher').hover()
  await page.locator('.composer-step-slider').fill('1')
  await page.locator('.composer-step-slider').fill('0')
  await page.locator('.composer-fast-toggle').click()
  await page.locator('.composer-fast-toggle').click()
  await closePreview(page)
  expect(selectionWrites).toEqual([])
  expect(api.unexpectedRequests).toEqual([])
})

test('launcher to panel cancels close and second hover-open click commits', async ({ page }) => {
  const { api, selectionWrites } = await setup(page)
  await page.locator('.composer-launcher').click()
  await expect(page.locator('.composer-model-bar')).toBeVisible()
  await page.locator('.composer-control').dispatchEvent('mouseleave')
  await page.locator('.composer-panel-wrap').dispatchEvent('mouseenter')
  await page.waitForTimeout(150)
  await expect(page.locator('.composer-model-bar')).toBeVisible()
  expect(selectionWrites).toEqual([])
  await dot(page, 'Deep').click()
  await page.locator('.composer-launcher').click()
  await expect(page.locator('.composer-model-bar')).toHaveCount(0)
  await expect.poll(() => selectionWrites.length).toBe(2)
  expect(api.unexpectedRequests).toEqual([])
})

test('failed close shows feedback and preserves original selection', async ({ page }) => {
  const { api, selectionWrites } = await setup(page)
  await page.route(/[/]api[/]studio[/]sessions[/][^/]+[/]model(?:[?].*)?$/, async route => {
    selectionWrites.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() })
    await route.fulfill({ status: 500, json: { error: 'Model switch rejected' } })
  })
  await dot(page, 'Deep').click()
  expect(selectionWrites).toEqual([])
  await closePreview(page)
  await expect(page.locator('.n-message')).toContainText('Could not switch model')
  await expect(page.locator('.input-model-label')).toContainText('fast-model')
  await expect(page.locator('.reasoning-effort-button')).toHaveAttribute('aria-label', /low/i)
  expect(selectionWrites).toHaveLength(1)
  await page.locator('.composer-launcher').hover()
  await expect(page.locator('.composer-step-label')).toHaveText('Quick')
  expect(api.unexpectedRequests).toEqual([])
})


test('session navigation discards a pending preview rather than writing it to either session', async ({ page }) => {
  const { api, selectionWrites } = await setup(page)
  await dot(page, 'Deep').click()
  expect(selectionWrites).toEqual([])
  // Hash navigation switches the active session without an outside-pointer close/commit.
  await page.evaluate(() => { window.location.hash = '/hermes/chat' })
  await expect(page.locator('.composer-model-bar')).toHaveCount(0)
  await page.waitForTimeout(150)
  expect(selectionWrites).toEqual([])
  expect(api.unexpectedRequests).toEqual([])
})

// Profile A = default, Profile B = research. No global Profile activation is needed.
test('Models edits Profile B without changing active chat/Profile A or contaminating its presets/default', async ({ page }) => {
  const { api, configWrites, configWriteProfiles, configReads, selectionWrites, getDisplay } = await setup(page)
  const aBefore = structuredClone(getDisplay())
  await openManager(page)
  await choose(page, page.getByTestId('models-profile-select'), 'research')
  await expect(page).toHaveURL(/modelProfile=research/)
  const panel = page.getByTestId('model-presets-panel')
  await expect(panel.getByTestId('composer-save')).toBeEnabled()
  const row = panel.getByTestId('composer-step')
  await expect(row).toHaveCount(1)
  await expect(row).toHaveAttribute('data-preset-id', 'research-deep')
  await row.getByTestId('composer-name').locator('input').fill('B saved only')
  await panel.getByTestId('composer-save').click()
  await expect.poll(() => configWrites.length).toBe(1)
  expect(configWriteProfiles).toEqual(['research'])
  expect(configWrites[0]).toEqual({ section: 'display', restart: false, values: {
    composer_steps: [{ ...presets[1], id: 'research-deep', label: 'B saved only' }], composer_default_step_id: 'research-deep',
  } })
  expect(configReads.filter(read => read.profile === 'research')).toEqual([{ profile: 'research', section: 'display' }])
  expect(getDisplay()).toEqual(aBefore)
  expect(await page.evaluate(() => localStorage.getItem('hermes_active_profile_name'))).toBe('default')
  expect(api.requests.filter(request => request.pathname === '/api/hermes/profiles/active')).toEqual([])
  expect(api.requests.some(request => request.pathname === '/api/hermes/available-models' && new URLSearchParams(request.search).get('profile') === 'research')).toBe(true)
  await choose(page, page.getByTestId('models-profile-select'), 'default')
  await expect(panel.getByTestId('composer-save')).toBeEnabled()
  await expect.poll(() => rowIds(panel)).toEqual(['quick', 'deep'])
  await expect(panel.getByTestId('composer-step').nth(0).getByTestId('composer-default')).toHaveAttribute('aria-pressed', 'true')
  await page.goto('/#/hermes/session/' + sessionId)
  await expect(page.locator('.input-model-label')).toContainText('fast-model')
  await expect(page.locator('.reasoning-effort-button')).toHaveAttribute('aria-label', /low/i)
  await page.locator('.composer-launcher').hover()
  await expect(page.locator('.composer-step-dot')).toHaveCount(2)
  await expect(dot(page, 'Quick')).toHaveAttribute('aria-pressed', 'true')
  await expect(dot(page, 'B saved only')).toHaveCount(0)
  expect(selectionWrites).toEqual([])
  expect(api.unexpectedRequests).toEqual([])
})

test('a late Profile B display response cannot refresh Profile A editor or overwrite its draft', async ({ page }) => {
  const { api, getDisplay } = await setup(page)
  const aBefore = structuredClone(getDisplay())
  await openManager(page)
  let release!: () => void
  let arrived = false
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route(/[/]api[/]hermes[/]config[?]section=display$/, async route => {
    if (route.request().headers()['x-hermes-profile'] !== 'research') { await route.fallback(); return }
    arrived = true
    await pending
    await route.fulfill({ json: { display: getDisplay('research') } })
  })
  await choose(page, page.getByTestId('models-profile-select'), 'research')
  await expect.poll(() => arrived).toBe(true)
  await expect(page.getByTestId('model-presets-panel')).toHaveAttribute('aria-busy', 'true')
  // Route-local selection remains independent even while B's editor request is pending.
  await choose(page, page.getByTestId('models-profile-select'), 'default')
  const panel = page.getByTestId('model-presets-panel')
  await expect(panel.getByTestId('composer-save')).toBeEnabled()
  const name = panel.getByTestId('composer-step').nth(0).getByTestId('composer-name').locator('input')
  await name.fill('A unsaved draft')
  const response = page.waitForResponse(response => response.url().includes('config?section=display') && response.request().headers()['x-hermes-profile'] === 'research')
  release()
  await (await response).finished()
  // Let the response parse and Vue render settle before inspecting A's draft.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect.poll(() => rowIds(panel)).toEqual(['quick', 'deep'])
  await expect(name).toHaveValue('A unsaved draft')
  await expect(panel.getByTestId('composer-step').nth(0).getByTestId('composer-default')).toHaveAttribute('aria-pressed', 'true')
  expect(getDisplay()).toEqual(aBefore)
  expect(await page.evaluate(() => localStorage.getItem('hermes_active_profile_name'))).toBe('default')
  expect(api.unexpectedRequests).toEqual([])
})


test('only the final close-time write temporarily guards the original controls; dragging never disables them', async ({ page }) => {
  await setup(page)
  const manualModel = page.locator('.input-model-button')
  const manualEffort = page.locator('.reasoning-effort-button')
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let started = false
  await page.route(new RegExp('/api/studio/sessions/' + sessionId + '/model$'), async route => {
    started = true
    await pending
    await route.fulfill({ json: { success: true } })
  })
  await dot(page, 'Deep').click()
  await expect(manualModel).toBeEnabled()
  await expect(manualEffort).toBeEnabled()
  await page.mouse.move(2, 2)
  await expect.poll(() => started).toBe(true)
  await expect(page.locator('.composer-model-bar')).toHaveCount(0)
  await expect(manualModel).toBeDisabled()
  await expect(manualEffort).toBeDisabled()
  release()
  await expect(manualModel).toBeEnabled()
  await expect(manualEffort).toBeEnabled()
  await expect(page.locator('.input-model-label')).toContainText('deep-model')
})
