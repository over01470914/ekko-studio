import { readFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { randomUUID } from 'crypto'
import { expect, test } from '@playwright/test'
import { authenticate } from './fixtures'

// Opt-in against the isolated API fixture and real Vite UI. Never mock Service
// Center endpoints here; the regular service-center.spec.ts handles UI mocks.
const tokenFile = process.env.SERVICE_CENTER_PREVIEW_TOKEN_FILE
test.skip(!tokenFile, 'Run only with the isolated Service Center preview harness')
const tokens = tokenFile ? JSON.parse(readFileSync(tokenFile, 'utf8')) as Record<string, string> : {}
const screenshotDir = process.env.SERVICE_CENTER_SCREENSHOT_DIR
const id = `live-${randomUUID().slice(0, 8)}`
const service = { id, name: 'Live test service', category: 'Development', description: 'Preview acceptance',
  tags: ['live'], url: 'https://example.org/', healthUrl: 'https://example.org/?view=dashboard&category=tools',
  icon: 'globe', network: 'public', enabled: true, sortOrder: 0 }

const request = (baseURL: string, role: string, path: string, method = 'GET', body?: unknown) =>
  fetch(`${baseURL}/api/studio/service-center${path}`, { method, headers: {
    Authorization: `Bearer ${tokens[role]}`,
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  }, body: body ? JSON.stringify(body) : undefined })

test.describe.configure({ mode: 'serial' })
test('real JWT, catalog persistence, permission, mutation and revision conflict', async ({ baseURL }) => {
  const base = baseURL!
  expect((await request(base, 'sc-preview-reader', '/catalog')).status).toBe(200)
  const readerDenied = await request(base, 'sc-preview-reader', '/services', 'PUT', { service, expectedRevision: 0 })
  expect(readerDenied.status).toBe(403)
  const ownerCatalog = await (await request(base, 'sc-preview-owner', '/catalog')).json()
  for (const field of ['url', 'healthUrl'] as const) {
    for (const key of [
      'accessToken', 'clientSecret', 'bearer', 'sig', 'X-Amz-Signature',
      'signature', 'X-Goog-Signature', 'accessCode', 'oauth_code',
      'verification_code', 'one_time_code', 'otp', 'password2', 'secret2', 'code',
      'passphrase', 'passphrase2', 'passPhrase', 'pass_phrase', 'pass-phrase-2', 'passPhrase2',
      'totp', 'TOTP', 'totp2',
      'oauthState', 'oauth_state', 'oauth-state-2', 'oauthstate2',
      'oauthVerifier', 'oauth_verifier', 'oauthVerifier2',
      'clientAssertion', 'client_assertion', 'clientAssertion2',
    ]) {
      const invalid = await request(base, 'sc-preview-owner', '/services', 'PUT', {
        service: { ...service, [field]: `https://example.org/?${key}=fixture` }, expectedRevision: ownerCatalog.revision,
      })
      expect(invalid.status, `${field} query key ${key}`).toBe(400)
    }
  }
  expect((await (await request(base, 'sc-preview-owner', '/catalog')).json()).revision).toBe(ownerCatalog.revision)
  const added = await request(base, 'sc-preview-owner', '/services', 'PUT', { service, expectedRevision: ownerCatalog.revision })
  expect(added.status).toBe(200)
  const created = await added.json()
  expect(created.services.some((entry: { id: string }) => entry.id === id)).toBe(true)
  expect(created.services.find((entry: { id: string }) => entry.id === id)?.healthUrl)
    .toBe('https://example.org/?view=dashboard&category=tools')
  expect((await request(base, 'sc-preview-owner', '/services', 'PUT', { service: { ...service, id: `${id}-stale` }, expectedRevision: ownerCatalog.revision })).status).toBe(409)
  const visibleToReader = await (await request(base, 'sc-preview-reader', '/catalog')).json()
  expect(visibleToReader.services.some((entry: { id: string }) => entry.id === id)).toBe(true)

  const editorAccount = await (await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${tokens['sc-preview-editor']}` } })).json()
  const editorResult = await request(base, 'sc-preview-owner', `/editors/${editorAccount.user.id}`, 'PUT', { granted: true })
  expect(editorResult.status).toBe(200)
  expect((await request(base, 'sc-preview-editor', `/editors/${editorAccount.user.id}`, 'PUT', { granted: true })).status).toBe(403)
  const editorCatalog = await (await request(base, 'sc-preview-editor', '/catalog')).json()
  expect(editorCatalog.capabilities.canManageServices).toBe(true)
  const updated = await request(base, 'sc-preview-editor', '/services', 'PUT', { service: { ...service, name: 'Live test service updated' }, expectedRevision: editorCatalog.revision })
  expect(updated.status).toBe(200)
  expect((await updated.json()).services.some((entry: { id: string, name: string }) => entry.id === id && entry.name.endsWith('updated'))).toBe(true)
  expect((await request(base, 'sc-preview-reader', `/health/${id}/approval`, 'PUT', { approved: true })).status).toBe(403)
  expect((await request(base, 'sc-preview-reader', `/health/${id}`, 'POST')).status).toBe(200)
  expect((await request(base, 'sc-preview-reader', `/favorites/${id}`, 'PUT', { favorite: true })).status).toBe(200)
  expect((await (await request(base, 'sc-preview-editor', '/catalog')).json()).favorites).not.toContain(id)
  expect((await request(base, 'sc-preview-owner', `/editors/${editorAccount.user.id}`, 'PUT', { granted: false })).status).toBe(200)
  expect((await request(base, 'sc-preview-editor', '/services', 'PUT', { service, expectedRevision: 0 })).status).toBe(403)
  expect((await request(base, 'sc-preview-owner', `/editors/${editorAccount.user.id}`, 'PUT', { granted: true })).status).toBe(200)
})

test('actual UI renders editor and reader roles at desktop and mobile sizes', async ({ page, browser, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await authenticate(page, tokens['sc-preview-editor'])
  await page.goto('/#/service-center')
  await expect(page.getByRole('heading', { name: 'Service Center' })).toBeVisible()
  const rail = page.locator('.app-shell > .studio-navigation-rail')
  await expect(rail).toBeVisible()
  const serviceCenterEntry = rail.getByRole('link', { name: 'Service Center', exact: true })
  await expect(serviceCenterEntry).toBeVisible()
  await expect(serviceCenterEntry).toHaveAttribute('aria-current', 'page')
  expect(await rail.boundingBox()).toMatchObject({ x: 0, width: 64 })
  const card = page.locator(`[data-service-id="${id}"]`)
  await expect(card.getByRole('link', { name: 'Live test service updated' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add service' })).toBeVisible()
  if (screenshotDir) {
    mkdirSync(screenshotDir, { recursive: true, mode: 0o700 })
    await page.screenshot({ path: resolve(screenshotDir, 'service-center-desktop.png'), fullPage: false, animations: 'disabled' })
  }
  await card.getByRole('button', { name: 'Edit' }).click()
  const editor = page.getByRole('dialog')
  await expect(editor.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Live test service updated')
  await expect.poll(() => editor.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
  if (screenshotDir) {
    await page.setViewportSize({ width: 1280, height: 1024 })
    await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
    await page.screenshot({ path: resolve(screenshotDir, 'service-center-editor.png'), fullPage: false, animations: 'disabled' })
  }
  await editor.getByRole('textbox', { name: 'Name', exact: true }).fill('Live test service from UI')
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(card.getByRole('link', { name: 'Live test service from UI' })).toBeVisible()
  const saved = await (await request(baseURL!, 'sc-preview-editor', '/catalog')).json()
  expect(saved.services.find((entry: { id: string }) => entry.id === id)?.name).toBe('Live test service from UI')
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await authenticate(mobile, tokens['sc-preview-reader'])
  await mobile.goto('/#/service-center')
  await expect(mobile.locator(`[data-service-id="${id}"]`).getByRole('link', { name: 'Live test service from UI' })).toBeVisible()
  await expect(mobile.getByRole('button', { name: 'Add service' })).toHaveCount(0)
  if (screenshotDir) await mobile.screenshot({ path: resolve(screenshotDir, 'service-center-mobile.png'), fullPage: true })
  await mobile.close()
})