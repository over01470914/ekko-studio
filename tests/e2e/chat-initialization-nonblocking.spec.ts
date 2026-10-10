import { test, expect } from '@playwright/test'
import { authenticate, mockHermesApi, mockChatSocket, TEST_ACCESS_KEY } from './fixtures'
for (const blocked of ['config', 'available-models']) {
  test(`chat history is usable when optional ${blocked} stays pending`, async ({ page }) => {
    const sid = 'nonblocking-chat'
    await authenticate(page, TEST_ACCESS_KEY, 'default')
    await mockHermesApi(page, { initialProfileName: 'default', sessions: [{
      id: sid, source: 'builtin_agent', agent: 'ekko-agent', profile: 'default', title: 'Existing chat',
      model: 'test-model', provider: 'test-provider', started_at: 100, last_active: 101, message_count: 1,
    }] })
    await mockChatSocket(page)
    await page.addInitScript(id => {
      ;(window as any).__PW_CHAT_SOCKET_RESUMES__ = { [id]: { session_id: id,
        messages: [{ id: 1, role: 'user', content: 'History remains usable', timestamp: 100 }],
        isWorking: false, events: [], queueLength: 0 } }
    }, sid)
    let blockedRequests = 0
    // Simulate a stalled API without external services or production credentials.
    await page.route(new RegExp('/api/hermes/' + blocked + '(?:[?].*)?$'), async () => {
      blockedRequests++
      await new Promise<void>(() => {})
    })
    await page.goto('/#/hermes/session/' + sid)
    await expect(page.getByText('History remains usable', { exact: true })).toBeVisible({ timeout: 5000 })
    await expect(page.getByPlaceholder('Type a message... (Enter to send, Shift+Enter for new line)')).toBeVisible()
    expect(blockedRequests).toBeGreaterThan(0)
    await expect(page.locator('.input-model-button')).toBeVisible()
    await expect(page.locator('.reasoning-effort-button')).toBeVisible()
    // No need to hover or fetch extra data to render the additional launcher.
    await expect(page.locator('.composer-launcher')).toBeVisible()
    await expect(page.locator('.composer-model-bar')).toHaveCount(0)
  })
}
