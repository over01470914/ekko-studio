import { expect, test } from '@playwright/test'
import { authenticate, mockChatSocket, mockHermesApi, TEST_ACCESS_KEY, TEST_MODEL_GROUP } from './fixtures'
import { selectNewChatAgent, sendNewChatMessage } from './new-chat-helpers'

test('new-chat page loads the local default preset without showing active-session preset controls', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'default')
  const api = await mockHermesApi(page, {
    initialProfileName: 'default',
    modelGroups: [{ ...TEST_MODEL_GROUP, models: ['first-model', 'preset-model'], available_models: ['first-model', 'preset-model'],
      model_meta: { 'preset-model': { reasoning_efforts: ['high', 'max'] } } }],
  })
  await mockChatSocket(page)
  await page.route(/\/api\/hermes\/config(?:\?.*)?$/, route => route.fulfill({
    json: {
      display: {
        streaming: true, show_reasoning: true, show_cost: true,
        composer_steps: [{ id: 'preferred', label: 'Preferred', providerId: TEST_MODEL_GROUP.provider, modelId: 'preset-model', reasoningLevel: 'high' }],
        composer_default_step_id: 'preferred',
      },
      agent: {}, memory: {}, session_reset: {}, privacy: {}, approvals: {},
    },
  }))
  await page.goto('/#/hermes/chat')
  await page.getByRole('button', { name: 'New Chat', exact: true }).click()
  await selectNewChatAgent(page, 'Ekko')
  const draft = page.locator('.new-chat-page')
  await expect(draft.locator('.input-model-label')).toContainText('preset-model')
  await expect(draft.locator('.composer-launcher')).toHaveCount(0)
  await expect(draft.locator('.reasoning-effort-button')).toHaveCount(1)
  await expect(draft.locator('.reasoning-effort-button')).toHaveAttribute('aria-label', /high/i)
  await draft.locator('.reasoning-effort-button').click()
  await page.getByRole('slider').focus()
  await page.keyboard.press('ArrowRight')
  await expect(draft.locator('.reasoning-effort-button')).toHaveAttribute('aria-label', /max/i)
  await page.keyboard.press('Escape')
  await sendNewChatMessage(page, 'Use my explicit reasoning choice')
  await expect.poll(() => page.evaluate(() => (window as any).__PW_CHAT_SOCKET__?.emitted
    ?.find((item: any) => item.event === 'run')?.payload.reasoning_effort)).toBe('max')
  expect(api.unexpectedRequests).toEqual([])
})
