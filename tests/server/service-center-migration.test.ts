import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, stat, readdir, rm } from 'fs/promises'
import { join } from 'path'

const legacyService = (category = 'Tools') => ({ id: 'legacy', name: 'Old service', description: 'Long description retained', url: 'https://example.org/#/tools/status',
  icon: 'tool', category, tags: ['old'], network: 'tailscale', enabled: true, sortOrder: 7, healthUrl: 'https://example.org/health', healthCheckEnabled: true })
const entry = (id = 'primary', url = 'https://example.org/') => ({ id, label: id, url, network: 'public' as const, login: 'unknown' as const })
const service = (id = 'first') => ({ id, name: id, description: '', icon: 'globe', tags: [], enabled: true, sortOrder: 0,
  categoryId: null, nodeId: null, endpoints: [entry()], defaultEndpointId: 'primary' })

describe('Service Center schema2 migration and organization', () => {
  let root: string
  let catalog: typeof import('../../packages/server/src/modules/studio/extensions/service-center/catalog')
  let manifest: typeof import('../../packages/server/src/modules/studio/extensions/service-center/manifest')
  let directory: typeof import('../../packages/server/src/modules/studio/extensions/service-center/directory')
  beforeEach(async () => {
    root = await mkdtemp(join(process.env.TMPDIR || '/tmp/', 'service-center-migration-'))
    vi.resetModules()
    const { installServiceCenterHost } = await import('../../packages/server/src/modules/studio/extensions/service-center/host')
    installServiceCenterHost({ dataRoot: root, actorFor: () => ({ id: 1, role: 'super_admin' }), eligibleAdmin: () => true })
    catalog = await import('../../packages/server/src/modules/studio/extensions/service-center/catalog')
    manifest = await import('../../packages/server/src/modules/studio/extensions/service-center/manifest')
    directory = await import('../../packages/server/src/modules/studio/extensions/service-center/directory')
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }); vi.doUnmock('fs/promises'); vi.resetModules() })
  it('shows editable presets without writing and never recreates deleted categories', async () => {
    expect((await catalog.catalog()).categories.map(item => item.id)).toEqual(['private-services', 'public-services'])
    expect(await readdir(root)).toEqual([])
    const next = await catalog.deleteOrganization(0, 'categories', 'private-services', null)
    expect(next.categories.map(item => item.id)).toEqual(['public-services'])
    expect((await catalog.catalog()).categories.map(item => item.id)).toEqual(['public-services'])
    expect((await readFile(join(root, 'catalog.json'), 'utf8')).includes('private-services')).toBe(false)
  })
  it('normalizes legacy on read without touching bytes, then backs up exact original on first authorized write', async () => {
    const original = `${JSON.stringify({ revision: 4, schemaVersion: 1, services: [legacyService()] }, null, 2)}\n`
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'catalog.json'), original, { mode: 0o600 })
    await writeFile(join(root, 'health-approvals.json'), JSON.stringify({ legacy: 'https://example.org/health' }), { mode: 0o600 })
    await catalog.setFavorite(22, 'legacy', true)
    const read = await catalog.catalog()
    expect(read.revision).toBe(4)
    expect(read.services[0]).toMatchObject({ id: 'legacy', nodeId: null, description: 'Long description retained',
      healthUrl: 'https://example.org/health', defaultEndpointId: 'primary', endpoints: [{ url: 'https://example.org/#/tools/status', network: 'tailscale', login: 'unknown' }] })
    expect(read.categories).toHaveLength(1)
    expect(await readFile(join(root, 'catalog.json'), 'utf8')).toBe(original)
    expect(await readdir(root)).not.toContain('catalog-v1.backup.json')
    await expect(catalog.saveService(3, service())).rejects.toMatchObject({ status: 409 })
    await expect(catalog.saveService(4, { ...service(), endpoints: [entry('primary', 'https://example.org/?token=x')] })).rejects.toThrow()
    expect(await readFile(join(root, 'catalog.json'), 'utf8')).toBe(original)
    expect(await readdir(root)).not.toContain('catalog-v1.backup.json')
    const upgraded = await catalog.saveOrganization(4, 'nodes', { id: 'mini', name: 'Mac mini', description: 'Fixture host', sortOrder: 0 })
    expect(upgraded.revision).toBe(5)
    expect(upgraded.schemaVersion).toBe(2)
    expect(await readFile(join(root, 'catalog-v1.backup.json'), 'utf8')).toBe(original)
    expect((await stat(join(root, 'catalog-v1.backup.json'))).mode & 0o777).toBe(0o600)
    expect(await catalog.getFavorites(22)).toEqual(['legacy'])
    expect(await catalog.isHealthApproved('legacy', 'https://example.org/health')).toBe(true)
    await expect(catalog.saveService(4, service())).rejects.toMatchObject({ status: 409 })
    expect(await readFile(join(root, 'catalog-v1.backup.json'), 'utf8')).toBe(original)
    vi.resetModules()
    const { installServiceCenterHost } = await import('../../packages/server/src/modules/studio/extensions/service-center/host')
    installServiceCenterHost({ dataRoot: root, actorFor: () => ({ id: 1, role: 'super_admin' }), eligibleAdmin: () => true })
    expect((await (await import('../../packages/server/src/modules/studio/extensions/service-center/catalog')).catalog()).revision).toBe(5)
  })
  it('rejects a backup mismatch before replacement and leaves the source catalog intact', async () => {
    const original = JSON.stringify({ revision: 2, schemaVersion: 1, services: [legacyService()] })
    await writeFile(join(root, 'catalog.json'), original)
    await writeFile(join(root, 'catalog-v1.backup.json'), 'different bytes')
    await expect(catalog.saveOrganization(2, 'nodes', { id: 'x', name: 'X', description: '', sortOrder: 0 })).rejects.toMatchObject({ status: 409 })
    expect(await readFile(join(root, 'catalog.json'), 'utf8')).toBe(original)
  })
  it('rolls back a just-created backup when catalog replacement fails, without advancing revision', async () => {
    const original = JSON.stringify({ revision: 2, schemaVersion: 1, services: [legacyService()] })
    await writeFile(join(root, 'catalog.json'), original)
    const actual = await import('fs/promises')
    vi.doMock('fs/promises', () => ({ ...actual, rename: async (source: string, dest: string) => {
      if (dest === join(root, 'catalog.json')) throw new Error('injected catalog rename failure')
      return actual.rename(source, dest)
    } }))
    vi.resetModules()
    const { installServiceCenterHost } = await import('../../packages/server/src/modules/studio/extensions/service-center/host')
    installServiceCenterHost({ dataRoot: root, actorFor: () => ({ id: 1, role: 'super_admin' }), eligibleAdmin: () => true })
    const guarded = await import('../../packages/server/src/modules/studio/extensions/service-center/catalog')
    await expect(guarded.saveService(2, service())).rejects.toThrow('injected catalog rename failure')
    expect(await readFile(join(root, 'catalog.json'), 'utf8')).toBe(original)
    expect(await readdir(root)).toEqual(['catalog.json'])
    vi.doUnmock('fs/promises')
  })
  it('serializes competing writes so only one actor can commit an expected revision', async () => {
    const outcomes = await Promise.allSettled([catalog.saveService(0, service('alpha')), catalog.saveService(0, service('beta'))])
    expect(outcomes.map(outcome => outcome.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect((outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult).reason.status).toBe(409)
    expect((await catalog.catalog()).services).toHaveLength(1)
  })
  it('enforces references, default entrance, duplicates and every URL, not just the default', async () => {
    const original = service()
    for (const invalid of [
      { ...original, endpoints: [entry('primary'), entry('alt', 'javascript:alert(1)')] },
      { ...original, endpoints: [entry('primary'), entry('alt', 'https://example.org/?access_token=x')] },
      { ...original, endpoints: [entry('primary'), entry('alt', 'https://example.org/#token=x')] },
      { ...original, endpoints: [entry('primary'), entry('alt', 'https://example.org/')], defaultEndpointId: 'gone' },
      { ...original, endpoints: [entry('primary'), entry('primary')] },
      { ...original, endpoints: [] },
    ]) expect(() => manifest.validateService(invalid)).toThrow()
    await expect(catalog.saveService(0, { ...original, nodeId: 'missing' })).rejects.toThrow()
    const saved = await catalog.saveService(0, { ...original, endpoints: [entry('primary'), entry('other')] })
    await expect(catalog.saveService(saved.revision, { ...original, endpoints: [entry('other')], defaultEndpointId: 'primary' })).rejects.toThrow()
    expect((await catalog.catalog()).revision).toBe(1)
    const changed = await catalog.saveService(1, { ...original, endpoints: [entry('other')], defaultEndpointId: 'other' })
    expect(changed.services[0].defaultEndpointId).toBe('other')
  })
  it('moves and deletes referenced category/node in one revision without losing service ID or favorite', async () => {
    const c = await catalog.saveOrganization(0, 'categories', { id: 'tools', name: 'Tools', sortOrder: 0 })
    await catalog.saveOrganization(c.revision, 'nodes', { id: 'mini', name: 'Mini', description: '', sortOrder: 0 })
    await catalog.saveService(2, { ...service(), categoryId: 'tools', nodeId: 'mini' })
    await catalog.setFavorite(44, 'first', true)
    await expect(catalog.deleteOrganization(3, 'categories', 'tools', undefined)).rejects.toMatchObject({ status: 400 })
    await expect(catalog.deleteOrganization(3, 'nodes', 'mini', 'missing')).rejects.toMatchObject({ status: 400 })
    const removedCategory = await catalog.deleteOrganization(3, 'categories', 'tools', null)
    const removedNode = await catalog.deleteOrganization(4, 'nodes', 'mini', null)
    expect(removedCategory.services[0].categoryId).toBe(null)
    expect(removedNode.services[0]).toMatchObject({ id: 'first', nodeId: null })
    expect(await catalog.getFavorites(44)).toEqual(['first'])
  })
  it('previews typed conflicts and legacy1 import, rejects hijacked names and leaves unmentioned records', async () => {
    const current = await catalog.saveService(0, service())
    const incoming = { schemaVersion: 1, services: [legacyService()] }
    const preview = catalog.previewImport(current, incoming)
    expect(preview.sourceSchemaVersion).toBe(1)
    expect(preview.newIds.services).toEqual(['legacy'])
    expect(preview.newIds.categories).toHaveLength(1)
    const after = await catalog.importManifest(1, incoming, {})
    expect(after.services.map(item => item.id).sort()).toEqual(['first', 'legacy'])
    const manifest2 = { schemaVersion: 2, categories: [{ ...after.categories.find(item => item.name === 'Tools')!, name: 'Tools renamed' }], nodes: [], services: [after.services.find(item => item.id === 'legacy')!] }
    const conflicts = catalog.previewImport(after, manifest2).conflicts
    expect(conflicts.map(item => item.key)).toEqual([`categories:${manifest2.categories[0].id}`, 'services:legacy'])
    await expect(catalog.importManifest(after.revision, manifest2, { legacy: 'overwrite' })).rejects.toThrow()
    const merged = await catalog.importManifest(after.revision, manifest2, Object.fromEntries(conflicts.map(item => [item.key, 'overwrite'])))
    expect(merged.services.some(item => item.id === 'first')).toBe(true)
    await expect(catalog.importManifest(merged.revision, { schemaVersion: 2, categories: [{ id: 'hijack', name: 'Tools renamed', sortOrder: 0 }], nodes: [], services: [] }, {})).rejects.toThrow()
    expect((await catalog.catalog()).revision).toBe(merged.revision)
  })
  it('accepts v2 references to existing groups without re-declaring them, and rejects unresolved references before preview', async () => {
    const c = await catalog.saveOrganization(0, 'categories', { id: 'tools', name: 'Tools', sortOrder: 0 })
    await catalog.saveOrganization(c.revision, 'nodes', { id: 'mini', name: 'Mac mini', description: '', sortOrder: 0 })
    const imported = { schemaVersion: 2, categories: [], nodes: [], services: [{ ...service(), categoryId: 'tools', nodeId: 'mini' }] }
    const preview = catalog.previewImport(await catalog.catalog(), imported)
    expect(preview.references).toEqual([{ id: 'first', categoryId: 'tools', nodeId: 'mini' }])
    const next = await catalog.importManifest(2, imported, {})
    expect(next.services[0]).toMatchObject({ categoryId: 'tools', nodeId: 'mini' })
    await expect(catalog.importManifest(3, { ...imported, services: [{ ...service('missing'), categoryId: 'missing' }] }, {})).rejects.toThrow()
    expect((await catalog.catalog()).revision).toBe(3)
  })
  it('requires editor grant for category and node mutations, with immediate same-actor revoke', async () => {
    const reader = { id: 44, role: 'admin' as const }
    const owner = { id: 1, role: 'super_admin' as const }
    await expect(directory.saveOrganization(reader, 0, 'categories', { id: 'x', name: 'X', sortOrder: 0 })).rejects.toMatchObject({ status: 403 })
    await catalog.setEditor(owner.id, reader.id, true)
    await directory.saveOrganization(reader, 0, 'categories', { id: 'x', name: 'X', sortOrder: 0 })
    await catalog.setEditor(owner.id, reader.id, false)
    await expect(directory.deleteOrganization(reader, 1, 'categories', 'x', null)).rejects.toMatchObject({ status: 403 })
    await expect(directory.saveOrganization(reader, 1, 'nodes', { id: 'host', name: 'Host', description: '', sortOrder: 0 })).rejects.toMatchObject({ status: 403 })
    expect((await catalog.catalog()).categories.some(item => item.id === 'x')).toBe(true)
  })
})
