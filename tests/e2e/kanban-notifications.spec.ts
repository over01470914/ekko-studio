import { expect, test } from '@playwright/test'
import { authenticate, mockChatSocket, mockHermesApi, TEST_ACCESS_KEY } from './fixtures'

const sessions = ['report-alpha', 'report-beta'].map((id, i) => ({
  id, profile: 'research', source: 'builtin_agent', agent: 'ekko-agent', title: id, model: 'test-model', provider: 'test-provider',
  started_at: 100 + i, last_active: 100 + i, ended_at: null, message_count: 1, tool_call_count: 0,
  input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0,
  billing_provider: null, estimated_cost_usd: 0, actual_cost_usd: null, cost_status: 'estimated',
}))
const resumes = Object.fromEntries(sessions.map(s => [s.id, { session_id: s.id, isWorking: false, events: [], messages: [{
  id: 1, session_id: s.id, role: 'user', content: 'Real transcript ' + s.id, timestamp: 100,
  tool_call_id: null, tool_calls: null, tool_name: null, token_count: null, finish_reason: null, reasoning: null,
}] }]))

test('arbitrary session notices stay outside transcript, poll, switch safely and unsubscribe', async ({ page }, testInfo) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await page.addInitScript(payload => {
    localStorage.setItem('hermes_brightness', 'dark')
    ;(window as any).__PW_CHAT_SOCKET_RESUMES__ = payload
  }, resumes)
  await mockHermesApi(page, { sessions, kanbanReporting: { enabled: true, diagnosticsEnabled: false } })
  await mockChatSocket(page)
  let alphaGets = 0, deleted = false
  const requests: string[] = []
  await page.route(/\/api\/studio\/sessions\/[^/]+\/kanban-notifications/, async route => {
    const req = route.request(), url = new URL(req.url())
    requests.push(req.method() + ' ' + url.pathname + '?' + url.searchParams)
    const alpha = url.pathname.includes('report-alpha')
    if (req.method() === 'DELETE') { deleted = true; await route.fulfill({ json: { ok: true } }); return }
    if (alpha) alphaGets++
    // A deliberately slow response must not show up after the session switch.
    if (alpha && alphaGets === 1) await new Promise(resolve => setTimeout(resolve, 700))
    await route.fulfill({ json: {
      subscriptions: deleted ? [] : [{ id: 'subscription-42', task_id: 'task-unrestricted', board: 'board-custom', wake_enabled: false }],
      notifications: [{ id: alpha ? 'alpha-event' : 'beta-event', task_id: 'task-unrestricted', board: 'board-custom', kind: 'review_requested', label: alpha ? 'Alpha milestone' : 'Beta milestone', occurred_at: 123, summary: 'Persisted notification only' }],
    } }).catch(() => {})
  })
  await page.goto('/#/hermes/session/report-alpha')
  await expect(page.getByText('Real transcript report-alpha', { exact: true })).toBeVisible()
  await expect.poll(() => alphaGets).toBe(1)
  await page.getByRole('link', { name: /report-beta/ }).first().click()
  const overlay = page.getByTestId('kanban-notification-overlay')
  await expect(overlay).not.toBeVisible()
  await page.getByRole('button', { name: 'Task notifications', exact: true }).click()
  await expect(overlay.getByText('Beta milestone', { exact: true })).toBeVisible()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(async () => (await page.locator('.kanban-session-reporting').boundingBox())?.height || 0).toBeLessThan(40)
    await expect.poll(async () => {
      const shell = await page.locator('.message-list-shell').boundingBox()
      const viewport = await page.locator('.message-list-shell .virtual-message-list-host').boundingBox()
      const reporting = await page.locator('.kanban-session-reporting').boundingBox()
      return !!shell && !!viewport && !!reporting
        && Math.abs(viewport.width - shell.width) < 2
        && Math.abs(viewport.x - shell.x) < 2
        && viewport.y >= reporting.y + reporting.height - 1
        && viewport.height > shell.height * 0.5
    }).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`reporting-layout-${width}.png`) })
  }
  await page.waitForTimeout(900)
  await expect(overlay).not.toContainText('Alpha milestone')
  await expect(page.locator('.message-list-shell .message')).not.toContainText(['Beta milestone'])
  expect(await page.evaluate(() => ((window as any).__PW_CHAT_SOCKET__?.emitted || []).filter((x: any) => x.event === 'run').length)).toBe(0)
  await overlay.locator('.subscriptions > summary').click()
  await overlay.getByRole('button', { name: 'Unsubscribe', exact: true }).click()
  await expect(overlay.getByRole('button', { name: 'Unsubscribe', exact: true })).toHaveCount(0)
  expect(requests).toContain('DELETE /api/studio/sessions/report-beta/kanban-notifications/subscription-42?profile=research')
  await expect.poll(() => requests.filter(r => r.startsWith('GET /api/studio/sessions/report-beta/')).length, { timeout: 15_000 }).toBeGreaterThan(2)
})

test('compact notifications expand history without moving chat and reset on session switch', async ({ page }, testInfo) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await page.addInitScript(payload => {
    localStorage.setItem('hermes_brightness', 'dark')
    ;(window as any).__PW_CHAT_SOCKET_RESUMES__ = payload
  }, resumes)
  await mockHermesApi(page, { sessions, kanbanReporting: { enabled: true, diagnosticsEnabled: true } })
  await mockChatSocket(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route(/\/api\/studio\/sessions\/[^/]+\/kanban-notifications/, route => route.fulfill({ json: {
    subscriptions: [],
    notifications: Array.from({ length: 100 }, (_, index) => ({
      id: index, task_id: 'task-42', board: 'studio-chat-identity', kind: 'blocked',
      label: index === 0 ? 'Latest task update' : 'Earlier task update ' + index,
      occurred_at: 1000 - index, summary: 'Full retained task evidence. '.repeat(80),
    })),
  } }))
  await page.goto('/#/hermes/session/report-alpha')
  await expect(page.getByText('Real transcript report-alpha', { exact: true })).toBeVisible()
  const trigger = page.getByRole('button', { name: 'Task notifications', exact: true })
  const panel = page.getByTestId('kanban-notification-overlay')
  await expect(trigger).toContainText('100')
  await expect(panel).not.toBeVisible()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(350)
    await page.screenshot({ path: testInfo.outputPath(`compact-${width}.png`) })
    const before = await page.locator('.virtual-message-list-host').boundingBox()
    await trigger.click()
    await expect(panel.getByText('Latest task update', { exact: true })).toBeVisible()
    await expect(panel.getByText('Earlier task update 1', { exact: true })).not.toBeVisible()
    await expect(panel.locator('.notice p').first()).not.toBeVisible()
    await expect(panel.locator('.task-group')).toHaveCount(1)
    const after = await page.locator('.virtual-message-list-host').boundingBox()
    expect(after).toEqual(before)
    const bounds = await panel.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    await expect(panel.locator('xpath=ancestor::*[contains(@class, "n-popover")][1]')).toHaveCSS('opacity', '1')
    await page.waitForTimeout(350)
    await page.screenshot({ path: testInfo.outputPath(`popover-${width}.png`) })
    await panel.locator('.notice-history > summary').click()
    await expect(panel.getByText('Earlier task update 1', { exact: true })).toBeVisible()
    await panel.locator('.notice > summary').first().click()
    await expect(panel.locator('.notice p').first()).toBeVisible()
    await expect.poll(async () => (await panel.boundingBox())!.height).toBeLessThan(510)
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(panel).not.toBeVisible()
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await trigger.click()
  await page.getByRole('link', { name: /report-beta/ }).first().focus()
  await page.keyboard.press('Enter')
  await expect(panel).not.toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(panel).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).not.toBeVisible()
  await page.getByRole('button', { name: 'Create task from this session', exact: true }).click()
  await expect(page.locator('.n-modal')).toBeVisible()
  await expect(panel).not.toBeVisible()
  expect(errors).toEqual([])
})

test('a revoked reporting session stops polling without repeatedly showing permission notices', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await mockHermesApi(page, { sessions, kanbanReporting: { enabled: true, diagnosticsEnabled: true } })
  await page.addInitScript(payload => { (window as any).__PW_CHAT_SOCKET_RESUMES__ = payload }, resumes)
  await mockChatSocket(page)
  let requests = 0
  await page.route(/\/api\/studio\/sessions\/[^/]+\/kanban-notifications/, async route => {
    requests++
    await route.fulfill({ status: 403, json: { error: 'session_forbidden' } })
  })
  await page.goto('/#/hermes/session/report-alpha')
  await expect(page.getByText('Real transcript report-alpha', { exact: true })).toBeVisible()
  await expect.poll(() => requests).toBe(1)
  await expect(page.locator('.kanban-session-reporting')).toHaveCount(0)
  await page.waitForTimeout(11_000)
  expect(requests).toBe(1)
  await expect(page.getByTestId('kanban-notification-overlay')).toHaveCount(0)
})

for (const diagnosticsEnabled of [false, true]) {
for (const runtime of ['hermes', 'ekko-agent']) {
test(`task drawer respects diagnostic capability ${diagnosticsEnabled} for ${runtime} and subscribes explicitly`, async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await mockHermesApi(page, { sessions: sessions.map(session => ({ ...session, agent: runtime, source: runtime === 'hermes' ? 'cli' : 'builtin_agent' })), kanbanReporting: { enabled: true, diagnosticsEnabled } })
  const task = { id: 'task-any', title: 'Subscribe task', body: '', assignee: null, status: 'todo', priority: 1, created_at: 100, runs: [] }
  await page.route(/\/api\/hermes\/kanban(?:\/|\?|$)/, async route => {
    const path = new URL(route.request().url()).pathname
    let body: any = {}
    if (path.endsWith('/boards')) body = { boards: [{ slug:'custom', name:'Custom', archived:false, is_current:true, counts:{todo:1}, total:1 }] }
    else if (path.endsWith('/capabilities')) body = { capabilities: { source:'hermes-cli', supports:{}, missing:[] } }
    else if (path.endsWith('/stats')) body = { stats:{by_status:{todo:1},by_assignee:{},total:1} }
    else if (path.endsWith('/assignees')) body = { assignees:[] }
    else if (path.endsWith('/attachments')) body = { attachments:[] }
    else if (path.endsWith('/task-any')) body = { task, comments:[],events:[],runs:[],latest_summary:null }
    else body = { tasks:[task] }
    await route.fulfill({ json: body })
  })
  const posts: { url: string; body: any }[] = []
  await page.route(/\/api\/studio\/sessions\/[^/]+\/kanban-notifications/, async route => {
    posts.push({url:route.request().url(),body:route.request().postDataJSON()})
    await route.fulfill({ json: { id:'saved', ...posts.at(-1)!.body } })
  })
  await page.addInitScript(() => localStorage.setItem('hermes.kanban.selectedBoard', 'custom'))
  await page.goto('/#/hermes/kanban')
  await page.getByRole('button', { name: 'Subscribe task', exact: true }).click()
  const form = page.getByTestId('kanban-task-subscription')
  await expect(form.getByRole('button', { name: 'Subscribe', exact: true })).toBeDisabled()
  await form.locator('.n-base-selection').click()
  await page.getByText('report-alpha · research', { exact:true }).click()
  await form.getByRole('button', { name: 'Subscribe', exact: true }).click()
  await expect.poll(() => posts.length).toBe(1)
  expect(posts[0].url).toContain('/report-alpha/kanban-notifications?profile=research')
  expect(posts[0].body).toEqual({ board:'custom', task_id:'task-any', wake_enabled:false })
  if (diagnosticsEnabled) {
    await form.getByRole('checkbox').check()
    await form.getByRole('button', { name:'Subscribe',exact:true }).click()
    await expect.poll(() => posts.length).toBe(2)
    expect(posts[1].body.wake_enabled).toBe(true)
  } else {
    await expect(form.getByRole('checkbox')).toHaveCount(0)
  }
})
}
}

test('notification trigger pulses on changes, not initial load or unchanged polling', async ({ page }) => {
  await page.clock.install()
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await mockHermesApi(page, { sessions, kanbanReporting: { enabled: true, diagnosticsEnabled: true } })
  await page.addInitScript(payload => { (window as any).__PW_CHAT_SOCKET_RESUMES__ = payload }, resumes)
  await mockChatSocket(page)
  let subscribed = false, completed = false, requests = 0
  await page.route(/\/api\/studio\/sessions\/[^/]+\/kanban-notifications/, route => {
    requests++
    return route.fulfill({ json: {
      subscriptions: subscribed ? [{ id: 1, board: 'test', task_id: 'task-1', wake_enabled: false }] : [],
      notifications: [{ id: 1, board: 'test', task_id: 'task-1', kind: completed ? 'completed' : 'created', label: completed ? 'Task completed' : 'Task created', occurred_at: 123 }],
    } })
  })
  await page.goto('/#/hermes/session/report-alpha')
  const content = page.locator('.notification-content')
  await expect(content.locator('.notice-count')).toHaveText('1')
  await expect(content).toHaveAttribute('data-change-version', '0')
  await expect.poll(() => requests).toBe(1)
  subscribed = true
  await page.clock.fastForward(10_001)
  await expect(content).toHaveAttribute('data-change-version', '1')
  await expect(content).toHaveClass(/is-updated/)
  await expect(content).toHaveCSS('animation-duration', '1.4s')
  await page.clock.fastForward(10_001)
  await expect.poll(() => requests).toBe(3)
  await expect(content).toHaveAttribute('data-change-version', '1')
  completed = true
  await page.clock.fastForward(10_001)
  await expect(content).toHaveAttribute('data-change-version', '2')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(content).toHaveCSS('animation-name', 'none')
  await expect(page.getByTestId('kanban-notification-overlay')).not.toBeVisible()
})

test('disabled reporting neither polls notifications nor exposes diagnostic controls', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await page.addInitScript(payload => { (window as any).__PW_CHAT_SOCKET_RESUMES__ = payload }, resumes)
  const api = await mockHermesApi(page, { sessions })
  await mockChatSocket(page)
  await page.goto('/#/hermes/session/report-alpha')
  await expect(page.getByText('Real transcript report-alpha', { exact: true })).toBeVisible()
  await expect.poll(() => api.requests.filter(request => request.pathname === '/api/studio/kanban-reporting').length).toBeGreaterThan(0)
  await expect(page.getByTestId('kanban-notification-overlay')).toHaveCount(0)
  await expect(page.locator('.kanban-create-from-session')).toHaveCount(0)
  expect(api.requests.filter(request => request.pathname.includes('/kanban-notifications'))).toEqual([])
  expect(api.unexpectedRequests).toEqual([])
})
