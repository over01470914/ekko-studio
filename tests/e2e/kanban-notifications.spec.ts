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

test('arbitrary session notices stay outside transcript, poll, switch safely and unsubscribe', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await page.addInitScript(payload => { (window as any).__PW_CHAT_SOCKET_RESUMES__ = payload }, resumes)
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
  await expect(overlay.getByText('Beta milestone', { exact: true })).toBeVisible()
  await page.waitForTimeout(900)
  await expect(overlay).not.toContainText('Alpha milestone')
  await expect(page.locator('.message-list-shell .message')).not.toContainText(['Beta milestone'])
  expect(await page.evaluate(() => ((window as any).__PW_CHAT_SOCKET__?.emitted || []).filter((x: any) => x.event === 'run').length)).toBe(0)
  await overlay.getByRole('button', { name: 'Unsubscribe', exact: true }).click()
  await expect(overlay.getByRole('button', { name: 'Unsubscribe', exact: true })).toHaveCount(0)
  expect(requests).toContain('DELETE /api/studio/sessions/report-beta/kanban-notifications/subscription-42?profile=research')
  await expect.poll(() => requests.filter(r => r.startsWith('GET /api/studio/sessions/report-beta/')).length, { timeout: 15_000 }).toBeGreaterThan(2)
})

for (const diagnosticsEnabled of [false, true]) {
test(`task drawer respects diagnostic capability ${diagnosticsEnabled} and subscribes explicitly`, async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await mockHermesApi(page, { sessions, kanbanReporting: { enabled: true, diagnosticsEnabled } })
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
