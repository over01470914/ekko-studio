import { expect, test } from '@playwright/test'
import { authenticate, mockHermesApi, TEST_ACCESS_KEY } from './fixtures'

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`MOCK FIXTURE account author stays separate from persona at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await authenticate(page, TEST_ACCESS_KEY, 'research')
    const api = await mockHermesApi(page, {
      accountUsername: 'fixture-account',
      accountAvatar: JSON.stringify({ type: 'image', dataUrl: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E' }),
      researchPersonaAvatar: { type: 'generated', seed: 'other-persona' },
    })
    await page.goto('/#/hermes/chat')
    const input = page.getByPlaceholder('Type a message... (Enter to send, Shift+Enter for new line)')
    await expect(input).toBeVisible()
    await input.fill('Fixture local input')
    await page.getByRole('button', { name: 'Send' }).click()
    const human = page.locator('.user-message-author').filter({ hasText: 'fixture-account' })
    await expect(human).toBeVisible()
    await expect(human.locator('img')).toHaveAttribute('src', /data:image\/svg\+xml/)
    await expect(page.locator('.user-message-author')).not.toContainText('Research')
    await expect(page.locator('.empty-logo')).toHaveCount(0)
    expect(api.unexpectedRequests).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`mock-account-persona-${viewport.width}.png`), fullPage: true })
  })

  test(`MOCK FIXTURE unavailable account never becomes persona at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await authenticate(page, TEST_ACCESS_KEY, 'research')
    const api = await mockHermesApi(page, { accountUnavailable: true, researchPersonaAvatar: { type: 'generated', seed: 'other-persona' } })
    await page.goto('/#/hermes/chat')
    const input = page.getByPlaceholder('Type a message... (Enter to send, Shift+Enter for new line)')
    await expect(input).toBeVisible()
    await input.fill('Unavailable account input')
    await page.getByRole('button', { name: 'Send' }).click()
    // Offline account API retains the current token's username hint, not a persona.
    await expect(page.locator('.user-message-author .message-author-name')).toHaveText('playwright')
    await expect(page.locator('.user-message-author')).not.toContainText('Research')
    expect(api.unexpectedRequests).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`mock-account-unavailable-${viewport.width}.png`), fullPage: true })
  })

  test(`MOCK FIXTURE peer input in the same session remains neutral at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await authenticate(page, TEST_ACCESS_KEY, 'research')
    const api = await mockHermesApi(page, { accountUsername: 'fixture-account' })
    await page.goto('/#/hermes/chat')
    const input = page.getByPlaceholder('Type a message... (Enter to send, Shift+Enter for new line)')
    await expect(input).toBeVisible()
    await input.fill('Own before peer')
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.locator('.user-message-author').first()).toContainText('fixture-account')
    const sessionId = await page.evaluate(() => {
      const state = (window as any).__PW_CHAT_SOCKET__
      return state.emitted.find((item: any) => item.event === 'run')?.payload.session_id as string
    })
    expect(sessionId).toBeTruthy()
    await page.evaluate(sid => {
      const socket = (window as any).__PW_CHAT_SOCKET__.latest
      socket.__trigger('run.peer_user_message', { event: 'run.peer_user_message', session_id: sid, message: { id: 'peer-fixture-1', content: 'Peer input' } })
      socket.__trigger('run.queued', { event: 'run.queued', session_id: sid, dequeued_queue_id: 'peer-fixture-1', queue_length: 0 })
    }, sessionId)
    await expect(page.locator('.user-message-author .message-author-name')).toHaveText(['fixture-account', 'default'])
    await expect(page.getByText('Peer input', { exact: true })).toBeVisible()
    expect(api.unexpectedRequests).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`mock-peer-neutral-${viewport.width}.png`), fullPage: true })
  })

  test(`MOCK FIXTURE account settings edits survive SPA navigation at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await authenticate(page, TEST_ACCESS_KEY, 'research')
    const api = await mockHermesApi(page, { accountUsername: 'fixture-account', researchPersonaAvatar: { type: 'generated', seed: 'other-persona' } })
    await page.route('**/api/auth/change-username', route => route.fulfill({ json: { success: true } }))
    await page.goto('/#/hermes/chat')
    const input = page.getByPlaceholder('Type a message... (Enter to send, Shift+Enter for new line)')
    await expect(input).toBeVisible()
    await input.fill('Local before settings')
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.locator('.user-message-author .message-author-name')).toHaveText('fixture-account')
    if (viewport.width < 600) await page.getByRole('button', { name: 'Menu', exact: true }).click()
    await page.locator('a[href="#/hermes/settings"]').first().click()
    if (viewport.width < 600) await page.keyboard.press('Escape')
    const sidebar = page.locator('.page-sidebar-account-btn')
    await page.getByRole('button', { name: 'Generate Random', exact: true }).click()
    await expect(sidebar.locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/)
    const upload = await page.locator('.avatar-display').screenshot()
    await page.locator('.avatar-section input[type="file"]').setInputFiles({ name: 'fixture-avatar.png', mimeType: 'image/png', buffer: upload })
    await expect(sidebar.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/)
    await page.getByRole('button', { name: 'Reset to Default', exact: true }).click()
    await expect(sidebar.locator('img')).toHaveCount(0)
    await page.getByRole('button', { name: 'Change Username', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('input[type="password"]').fill('fixture-password')
    await dialog.locator('input:not([type="password"])').fill('renamed-account')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(sidebar).toContainText('renamed-account')
    if (viewport.width < 600) await page.getByRole('button', { name: 'Menu', exact: true }).click()
    await page.locator('a[href="#/hermes/chat"]').first().click()
    if (viewport.width < 600) await page.keyboard.press('Escape')
    await expect(page.locator('.user-message-author .message-author-name')).toHaveText('renamed-account')
    await expect(page.locator('.user-message-author')).not.toContainText('Research')
    expect(api.unexpectedRequests).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`mock-account-edits-${viewport.width}.png`), fullPage: true })
  })

  test(`MOCK FIXTURE historical input has no viewer or persona author at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await authenticate(page, TEST_ACCESS_KEY, 'research')
    const api = await mockHermesApi(page, { accountUsername: 'fixture-account', researchPersonaAvatar: { type: 'generated', seed: 'other-persona' } })
    const session = {
      id: 'hist-r1', profile: 'research', source: 'cli', model: 'test-model', provider: 'test-provider',
      title: 'Fixture history', preview: 'Historical unknown author', started_at: 1790000000,
      ended_at: null, last_active: 1790000001, message_count: 2, tool_call_count: 0,
      input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0,
      reasoning_tokens: 0, billing_provider: null, estimated_cost_usd: 0, actual_cost_usd: null,
      cost_status: '', workspace: null,
    }
    await page.route('**/api/studio/sessions/hermes/groups?**', route => route.fulfill({ json: { groups: [{ source: 'cli', sessions: [session], hasMore: false }], included: [session] } }))
    const messages = [
      { id: 1, session_id: session.id, role: 'user', content: 'Historical unknown author', timestamp: 1790000000 },
      { id: 2, session_id: session.id, role: 'assistant', content: 'Historical reply', timestamp: 1790000001 },
    ]
    await page.route('**/api/studio/sessions/hermes/hist-r1*', route => route.fulfill({ json: { session: { ...session, messages } } }))
    await page.route('**/api/studio/sessions/conversations/hist-r1/messages/paginated*', route => route.fulfill({ json: {
      session, messages, workspaceRunChanges: [], total: 2, offset: 0, limit: 150, hasMore: false,
    } }))
    await page.goto('/#/hermes/history/session/hist-r1')
    await expect(page.getByText('Historical unknown author', { exact: true })).toBeVisible()
    await expect(page.locator('.user-message-author .message-author-name')).toHaveText('default')
    await expect(page.locator('.assistant-message-author .message-author-name')).toHaveText('Hermes')
    expect(api.unexpectedRequests).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`mock-history-neutral-${viewport.width}.png`), fullPage: true })
  })
}
