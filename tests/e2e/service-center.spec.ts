import { expect, test, type Page } from '@playwright/test'
import { authenticate, mockHermesApi, TEST_ACCESS_KEY } from './fixtures'

const sample = (id = 'sample', name = 'Sample Tool') => ({ id, name, description: 'A browser tool', url: 'https://example.org/tool', icon: 'globe', category: 'Tools', tags: ['search'], network: 'public', enabled: true, sortOrder: 0 })

type Service = ReturnType<typeof sample>
async function directory(page: Page, editor: boolean) {
  let revision = 1
  let services: Service[] = [sample()]
  let favorites: string[] = []
  let editorIds: number[] = []
  let failNextSave = false
  const requests: Array<{ method: string; path: string; body: any }> = []
  await page.route('**/api/studio/service-center/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/api/studio/service-center', '')
    const method = request.method()
    const body = request.postDataJSON() || {}
    requests.push({ method, path, body })
    const reply = (json: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) })
    if (method === 'GET' && path === '/catalog') return reply({ revision, services: editor ? services : services.filter(service => service.enabled), favorites, health: {}, capabilities: { canManageServices: editor, canManageEditors: editor } })
    if (method === 'GET' && path === '/manifest') return reply({ schemaVersion: 1, services: editor ? services : services.filter(service => service.enabled) })
    if (method === 'GET' && path === '/editors') return reply({ editorIds })
    if (method === 'PUT' && path.startsWith('/editors/')) { editorIds = body.granted ? [2] : []; return reply({ editorIds }) }
    if (!editor && !path.startsWith('/favorites/') && !path.startsWith('/health/')) return reply({ error: 'Service Center editor required' }, 403)
    if (method === 'PUT' && path.startsWith('/favorites/')) { favorites = body.favorite ? [path.split('/').at(-1)!] : []; return reply({ favorites }) }
    if (method === 'POST' && path.startsWith('/health/')) return reply({ state: 'unapproved', status: null, checkedAt: null, latencyMs: null })
    if (method === 'PUT' && path === '/services') {
      if (failNextSave) { failNextSave = false; return reply({ error: 'Catalog changed' }, 409) }
      if (body.expectedRevision !== revision) return reply({ error: 'Catalog changed' }, 409)
      services = services.filter(service => service.id !== body.service.id).concat(body.service)
      revision++
      return reply({ revision, services })
    }
    if (method === 'DELETE' && path.startsWith('/services/')) {
      services = services.filter(service => service.id !== path.split('/').at(-1)); revision++; return reply({ revision, services })
    }
    if (method === 'POST' && path === '/import/preview') return reply({ revision, count: body.manifest.services.length,
      newIds: body.manifest.services.filter((item: Service) => !services.some(existing => existing.id === item.id)).map((item: Service) => item.id),
      conflicts: body.manifest.services.filter((item: Service) => services.some(existing => existing.id === item.id)).map((item: Service) => ({ id: item.id, current: services.find(existing => existing.id === item.id), incoming: item })) })
    if (method === 'POST' && path === '/import/confirm') { services = services.concat(body.manifest.services.filter((item: Service) => !services.some(existing => existing.id === item.id))); revision++; return reply({ revision }) }
    return reply({ error: 'Unexpected request' }, 500)
  })
  await page.route('https://example.org/tool', route => route.fulfill({ status: 200, body: 'destination opened' }))
  return { requests, services: () => services, setServices: (next: Service[]) => { services = next; revision++ }, failSave: () => { failNextSave = true } }
}

test('sidebar, directory, search, categories, favorites and exact safe new tab for a reader', async ({ page, context }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await mockHermesApi(page)
  const api = await directory(page, false)
  await page.goto('/#/hermes/chat')
  await expect(page.locator('a[href="#/service-center"]').first()).toBeVisible()
  await page.locator('a[href="#/service-center"]').first().click()
  await expect(page.getByRole('heading', { name: 'Service Center' })).toBeVisible()
  await expect(page.locator('[data-service-id="sample"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add service' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Editors' })).toHaveCount(0)
  const link = page.locator('[data-service-id="sample"] a.service-card__link')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(link).toHaveAttribute('href', 'https://example.org/tool')
  const popup = context.waitForEvent('page')
  await link.click()
  const opened = await popup
  await opened.waitForLoadState('domcontentloaded')
  expect(opened.url()).toBe('https://example.org/tool')
  await page.getByRole('textbox', { name: 'Search name, category or tag' }).fill('missing')
  await expect(page.getByText('No matching services.')).toBeVisible()
  await page.getByRole('textbox', { name: 'Search name, category or tag' }).fill('search')
  await expect(page.locator('[data-service-id="sample"]')).toBeVisible()
  await page.getByRole('button', { name: 'Add to favorites' }).click()
  await page.getByRole('button', { name: 'Favorites', exact: true }).click()
  await expect(page.locator('[data-service-id="sample"]')).toBeVisible()
  api.setServices([...api.services(), { ...sample('hidden', 'Hidden'), enabled: false }])
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.locator('[data-service-id="hidden"]')).toHaveCount(0)
  expect(api.requests.some(request => request.path === '/favorites/sample' && request.method === 'PUT')).toBe(true)
  await page.goto('/#/hermes/settings')
  await expect(page).toHaveURL(/settings/)
})

test('editor saves to the same catalog, imports and exports through the runtime API', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await mockHermesApi(page)
  const api = await directory(page, true)
  await page.goto('/#/service-center')
  await expect(page.locator('[data-service-id="sample"]')).toBeVisible()
  await page.getByRole('button', { name: 'Add service' }).click()
  const modal = page.getByRole('dialog')
  await modal.getByRole('textbox', { name: 'Stable ID' }).fill('added')
  await modal.getByRole('textbox', { name: 'Name', exact: true }).fill('Added Tool')
  await modal.getByRole('textbox', { name: 'Web address' }).fill('https://example.org/tool')
  await modal.getByRole('textbox', { name: 'Category', exact: true }).fill('Tools')
  await modal.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('[data-service-id="added"]')).toBeVisible()
  expect(api.requests.some(request => request.path === '/services' && request.body.expectedRevision === 1)).toBe(true)
  await page.getByRole('button', { name: 'Export JSON' }).click()
  await expect.poll(() => api.requests.some(request => request.path === '/manifest')).toBe(true)
  await page.getByRole('button', { name: 'Import JSON' }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: 'service-center.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, services: [sample('imported', 'Imported Tool')] })) })
  await page.getByRole('button', { name: 'Preview import' }).click()
  await expect(page.getByText(/1 entries: 1 new/)).toBeVisible()
  await page.getByRole('button', { name: 'Confirm import' }).click()
  await expect(page.locator('[data-service-id="imported"]')).toBeVisible()
  await expect(page.locator('[data-service-id="sample"]')).toBeVisible()
})

test('editing, disabling, stale-write failure and super-admin grant controls', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  await mockHermesApi(page)
  await page.route('**/api/auth/users', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    users: [{ id: 2, username: 'fixture-admin', role: 'admin', status: 'active' }],
  }) }))
  const api = await directory(page, true)
  await page.goto('/#/service-center')
  const card = page.locator('[data-service-id="sample"]')
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Edit' }).click()
  const modal = page.getByRole('dialog')
  await modal.getByRole('textbox', { name: 'Name', exact: true }).fill('Renamed Tool')
  await modal.getByRole('switch').first().click()
  await modal.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(card.getByRole('link', { name: 'Renamed Tool' })).toBeVisible()
  expect(api.services().find(service => service.id === 'sample')?.enabled).toBe(false)
  await card.getByRole('button', { name: 'Edit' }).click()
  api.failSave()
  await modal.getByRole('textbox', { name: 'Name', exact: true }).fill('Not saved')
  await modal.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(modal.getByRole('alert')).toContainText('Catalog changed')
  expect(api.services().find(service => service.id === 'sample')?.name).toBe('Renamed Tool')
  await modal.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Editors', exact: true }).click()
  const permissions = page.getByRole('dialog')
  await expect(permissions.getByText('fixture-admin')).toBeVisible()
  await permissions.getByRole('button', { name: 'Grant editing' }).click()
  await expect(permissions.getByRole('button', { name: 'Revoke editing' })).toBeVisible()
  expect(api.requests.some(request => request.path === '/editors/2' && request.body.granted === true)).toBe(true)
})