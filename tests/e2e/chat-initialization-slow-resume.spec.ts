import { expect, test } from '@playwright/test'
import { authenticate, mockHermesApi, TEST_ACCESS_KEY } from './fixtures'

const slowId = 'slow-valid-history'
const nextId = 'newer-history'
const history = 'Valid history delivered after twelve seconds'
const newerHistory = 'History from the newer session'

async function setup(page: import('@playwright/test').Page, retryDelay?: number, initialDelay = 12_000) {
  let slowResumes = 0
  await authenticate(page, TEST_ACCESS_KEY, 'default')
  await mockHermesApi(page, {
    initialProfileName: 'default',
    sessions: [slowId, nextId].map(id => ({ id, source: 'builtin_agent', agent: 'ekko-agent', profile: 'default', title: id, model: 'test-model', provider: 'test-provider', started_at: 100, last_active: 101, message_count: 1 })),
  })
  await page.unroute('**/node_modules/.vite/**/socket__io-client.js*')
  await page.routeWebSocket('**/socket.io/**', socket => {
    const timers = new Set<ReturnType<typeof setTimeout>>()
    socket.onClose(() => { for (const timer of timers) clearTimeout(timer) })
    socket.onMessage(message => {
      const packet = String(message)
      if (packet === '2') { socket.send('3'); return }
      if (packet.startsWith('40')) {
        const namespace = packet.slice(2).split(',')[0] || ''
        socket.send('40' + namespace + (namespace ? ',' : '') + JSON.stringify({ sid: 'fixture' + namespace }))
        return
      }
      if (!packet.startsWith('42/chat-run,')) return
      const [event, payload] = JSON.parse(packet.slice('42/chat-run,'.length))
      if (event !== 'resume') return
      const sid = payload.session_id
      const retry = sid === slowId && ++slowResumes > 1 && retryDelay !== undefined
      const timer = setTimeout(() => { timers.delete(timer); socket.send('42/chat-run,' + JSON.stringify(['resumed', {
        session_id: sid,
        messages: [{ id: 1, role: 'user', content: retry ? 'History from the retry' : sid === slowId ? history : newerHistory, timestamp: 100 }],
        isWorking: false, events: [], queueLength: 0,
      }])) }, retry ? retryDelay : sid === slowId ? initialDelay : 0)
      timers.add(timer)
    })
    socket.send('0' + JSON.stringify({ sid: 'engine-fixture', upgrades: [], pingInterval: 60_000, pingTimeout: 60_000, maxPayload: 1_000_000 }))
  })
}

test('slow valid history recovers automatically without Retry', async ({ page }) => {
  await setup(page)
  await page.goto('/#/hermes/session/' + slowId)
  await expect(page.getByText('Chat loading is taking too long. Check the connection and retry.', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(history, { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.chat-initialization-error')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('slow-history-recovered.png'), fullPage: true })
})

test('navigation while slow history is pending ignores the old response', async ({ page }) => {
  await setup(page)
  await page.goto('/#/hermes/session/' + slowId)
  await expect(page.getByText('Chat loading is taking too long. Check the connection and retry.', { exact: true })).toBeVisible({ timeout: 15_000 })
  await page.evaluate(id => { window.location.hash = '/hermes/session/' + id }, nextId)
  await expect(page.getByText(newerHistory, { exact: true })).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(3_000)
  await expect(page.getByText(history, { exact: true })).toHaveCount(0)
  await expect(page.getByText(newerHistory, { exact: true })).toBeVisible()
  await expect(page.locator('.chat-initialization-error')).toHaveCount(0)
})

test('Retry supersedes the slow response for the same session', async ({ page }) => {
  await setup(page, 0)
  await page.goto('/#/hermes/session/' + slowId)
  await expect(page.getByText('Chat loading is taking too long. Check the connection and retry.', { exact: true })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText('History from the retry', { exact: true })).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(3_000)
  await expect(page.getByText(history, { exact: true })).toHaveCount(0)
  await expect(page.getByText('History from the retry', { exact: true })).toBeVisible()
})

test('Retry ignores the first response even when it arrives before the new response', async ({ page }) => {
  await setup(page, 4_000)
  await page.goto('/#/hermes/session/' + slowId)
  await expect(page.locator('.chat-initialization-error')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await page.waitForTimeout(2_300)
  await expect(page.getByText(history, { exact: true })).toHaveCount(0)
  await expect(page.getByText('History from the retry', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(history, { exact: true })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('retry-old-response-rejected.png'), fullPage: true })
})

test('real resume timeout retains an error and permits a successful Retry', async ({ page }) => {
  await setup(page, 0, 30_000)
  await page.goto('/#/hermes/session/' + slowId)
  await expect(page.locator('.chat-initialization-error')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.chat-initialization-error')).toContainText('Could not load this chat. Please retry.', { timeout: 10_000 })
  await page.screenshot({ path: test.info().outputPath('real-timeout-retry-available.png'), fullPage: true })
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText('History from the retry', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.chat-initialization-error')).toHaveCount(0)
})

test('session-list HTTP failure retains an error instead of showing empty chat', async ({ page }) => {
  await setup(page, 0, 0)
  let fail = true
  await page.route('**/api/studio/sessions**', async route => {
    if (new URL(route.request().url()).pathname !== '/api/studio/sessions' || !fail) return route.fallback()
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Session list unavailable' }) })
  })
  await page.goto('/#/hermes/session/' + slowId)
  await expect(page.locator('.chat-initialization-error')).toContainText('Could not load this chat. Please retry.', { timeout: 10_000 })
  fail = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText(history, { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.chat-initialization-error')).toHaveCount(0)
})
