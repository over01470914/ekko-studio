import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'fs/promises'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'

const specimen = (id = 'sample') => ({
  id, name: 'Sample', description: 'A browser UI', url: 'https://example.org/',
  icon: 'globe', category: 'Tools', tags: ['sample'], network: 'public', enabled: true, sortOrder: 1,
})

describe('Studio Service Center v1', () => {
  let home: string
  let db: DatabaseSync
  let users: typeof import('../../packages/server/src/modules/studio/repositories/users-store')
  let repository: typeof import('../../packages/server/src/modules/studio/extensions/service-center/catalog')
  let controller: typeof import('../../packages/server/src/modules/studio/extensions/service-center/controller')
  let auth: typeof import('../../packages/server/src/modules/studio/middleware/auth')
  let manifest: typeof import('../../packages/server/src/modules/studio/extensions/service-center/manifest')
  let superId: number
  let readerId: number
  let editorId: number
  const context = (id: number, body: Record<string, unknown> = {}, params: Record<string, unknown> = {}) => ({
    state: { user: { id } }, request: { body }, params, status: 200, body: null as unknown,
    set: vi.fn(), path: '/api/studio/service-center/catalog', headers: {}, query: {}, get: () => '',
  })

  beforeEach(async () => {
    home = await mkdtemp(join(process.env.TMPDIR || '/tmp/', 'service-center-test-'))
    vi.stubEnv('HERMES_WEB_UI_HOME', home)
    vi.stubEnv('AUTH_JWT_SECRET', 'test-only-jwt-secret')
    vi.resetModules()
    db = new DatabaseSync(':memory:')
    vi.doMock('../../packages/server/src/modules/studio/infrastructure/database/index', () => ({ getDb: () => db, getStoragePath: () => ':memory:' }))
    vi.doMock('../../packages/server/src/modules/studio/public/profile-config', () => ({ listProfileNamesFromDisk: () => ['default'] }))
    const schemas = await import('../../packages/server/src/modules/studio/infrastructure/database/schemas')
    schemas.initAllHermesTables()
    users = await import('../../packages/server/src/modules/studio/repositories/users-store')
    superId = users.createUser({ username: 'fixture-owner', password: 'test-password', role: 'super_admin' })!.id
    readerId = users.createUser({ username: 'fixture-reader', password: 'test-password', role: 'admin' })!.id
    editorId = users.createUser({ username: 'fixture-editor', password: 'test-password', role: 'admin' })!.id
    const { installServiceCenterHost } = await import('../../packages/server/src/modules/studio/extensions/service-center/host')
    installServiceCenterHost({ dataRoot: join(home, 'service-center'), actorFor(ctx) {
      const id = ctx.state.user?.id
      const user = typeof id === 'number' ? users.findUserById(id) : null
      if (!user || user.status !== 'active') throw new Error('Inactive actor')
      return { id, role: user.role }
    }, eligibleAdmin(id) { const user = users.findUserById(id); return !!user && user.status === 'active' && user.role === 'admin' } })
    repository = await import('../../packages/server/src/modules/studio/extensions/service-center/catalog')
    controller = await import('../../packages/server/src/modules/studio/extensions/service-center/controller')
    auth = await import('../../packages/server/src/modules/studio/middleware/auth')
    manifest = await import('../../packages/server/src/modules/studio/extensions/service-center/manifest')
  })
  afterEach(async () => {
    db.close()
    vi.doUnmock('../../packages/server/src/modules/studio/infrastructure/database/index')
    vi.doUnmock('../../packages/server/src/modules/studio/public/profile-config')
    vi.unstubAllEnvs()
    vi.resetModules()
    await rm(home, { recursive: true, force: true })
  })

  it('validates the tracked manifest rules, rejects credential URLs and imports atomically', async () => {
    expect(manifest.validateManifest({ schemaVersion: 1, services: [specimen()] }).services).toHaveLength(1)
    for (const bad of [
      'javascript:alert(1)', 'https://name:pass@example.org/',
      'https://example.org/?access_token=abc', 'https://example.org/?accessToken=abc',
      'https://example.org/?clientSecret=abc', 'https://example.org/?APIKey=x',
      'https://example.org/?api-key=x', 'https://example.org/?session_id=abc',
      'https://example.org/?refreshToken=x', 'https://example.org/?jwt=x',
      'https://example.org/?bearer=x', 'https://example.org/?signature=x',
      'https://example.org/?sig=x', 'https://example.org/?requestSignature=x',
      'https://example.org/?X-Amz-Signature=x', 'https://example.org/?X-Goog-Signature=x',
      'https://example.org/?XAmzSignature=x',
      'https://example.org/?accessCode=x', 'https://example.org/?oauth_code=x',
      'https://example.org/?verification_code=x', 'https://example.org/?one_time_code=x',
      'https://example.org/?otp=x', 'https://example.org/?password2=x',
      'https://example.org/?secret2=x', 'https://example.org/?code=x',
      'https://example.org/?accesscode=x', 'https://example.org/?code2=x',
      'https://example.org/?%61ccess%43ode=x', 'https://example.org/?%2563ode=x',
      'https://example.org/?passphrase=x', 'https://example.org/?passphrase2=x',
      'https://example.org/?passPhrase=x', 'https://example.org/?pass_phrase=x',
      'https://example.org/?pass-phrase-2=x', 'https://example.org/?passPhrase2=x',
      'https://example.org/?totp=x', 'https://example.org/?TOTP=x',
      'https://example.org/?totp2=x',
      'https://example.org/?oauthState=x', 'https://example.org/?oauth_state=x',
      'https://example.org/?oauth-state-2=x', 'https://example.org/?oauthstate2=x',
      'https://example.org/?oauthVerifier=x', 'https://example.org/?oauth_verifier=x',
      'https://example.org/?oauthVerifier2=x',
      'https://example.org/?clientAssertion=x', 'https://example.org/?client_assertion=x',
      'https://example.org/?clientAssertion2=x',
      // Credential schemes use both glued-together names and short vendor-specific keys.
      ...[
        'idtoken', 'xapikey', 'credentials', 'cred', 'authz', 'hdnts',
        'sessionid', 'sid', 'sas', 'sp', 'sv', 'se', 'st', 'ticket',
        'sso', 'ssoid', 'hmac', 'xmlsig', 'keyhash', 'certificate',
        'pkce', 'saml', 'pass', 'shadow', 'dkim', 'authheader', 'keyid',
        'idToken2', 'x-api-key', 'session_id', 'X-Amz-Credential',
        'X-Goog-Credential', 'ssoTicket', 'sig%256Eature',
        'unrecognized', 'view2', 'view%5Btoken%5D',
      ].map(key => `https://example.org/?${key}=fixture`),
      // Fragments are retained in catalog/export even when health GET omits them.
      'https://example.org/#access_token=fixture',
      'https://example.org/#refresh_token=fixture',
      'https://example.org/#id_token=fixture',
      'https://example.org/#sessionid=fixture',
      'https://example.org/#password=fixture',
      'https://example.org/#secret=fixture',
      'https://example.org/#bearer=fixture',
      'https://example.org/#/dashboard?access_token=fixture',
      'https://example.org/#%61ccess_token%3Dfixture',
      'https://example.org/#access_token%253Dfixture',
      'https://example.org/#access_token:fixture',
      'file:///etc/hosts', 'https://example.org/\n',
    ]) {
      expect(() => manifest.validateService({ ...specimen(), url: bad }), `navigation URL ${bad}`).toThrow()
      expect(() => manifest.validateService({ ...specimen(), healthUrl: bad }), `health URL ${bad}`).toThrow()
    }
    const benignKeys = ['view', 'category', 'tag', 'q', 'page', 'sort', 'lang',
      'id', 'name', 'filter', 'tab', 'ref', 'highlight']
    const benign = `https://example.org/?${benignKeys.map(key => `${key}=fixture`).join('&')}`
    expect(manifest.validateNavigationUrl(benign)).toBe(true)
    expect(() => manifest.validateService({ ...specimen(), url: benign, healthUrl: benign })).not.toThrow()
    for (const anchor of ['#overview', '#/dashboard', '#/tools/status']) {
      expect(() => manifest.validateService({ ...specimen(), url: `https://example.org/${anchor}`,
        healthUrl: `https://example.org/${anchor}` })).not.toThrow()
    }
    expect(manifest.validateNavigationUrl('https://example.org/?view=dashboard&sessionid=fixture')).toBe(false)
    expect(() => manifest.validateManifest({ schemaVersion: 2, services: [] })).toThrow()
    expect(() => manifest.validateManifest({ schemaVersion: 1, services: [specimen(), specimen()] })).toThrow()
    expect(() => manifest.validateService({ ...specimen(), enabled: true, permission: 'editor' })).toThrow()
    const initial = await repository.saveService(0, specimen())
    expect(initial.revision).toBe(1)
    await expect(repository.importManifest(1, { schemaVersion: 1, services: [specimen('new'), { ...specimen('bad'), url: 'data:text/html,x' }] }, {})).rejects.toThrow()
    expect(await repository.catalog()).toEqual(initial)
  })

  it('serializes revision writes, requires conflict choices and preserves unrelated entries', async () => {
    const first = await repository.saveService(0, specimen())
    const attempts = await Promise.allSettled([repository.saveService(1, specimen('two')), repository.saveService(1, specimen('three'))])
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((await repository.catalog()).revision).toBe(2)
    const incoming = { schemaVersion: 1, services: [{ ...specimen(), name: 'Overwrite' }, specimen('four')] }
    expect(repository.previewImport(await repository.catalog(), incoming).conflicts).toHaveLength(1)
    await expect(repository.importManifest(2, incoming, {})).rejects.toThrow()
    const after = await repository.importManifest(2, incoming, { sample: 'keep' })
    expect(after.services.find(service => service.id === 'sample')?.name).toBe('Sample')
    expect(after.services.map(service => service.id)).toContain('four')
    await expect(repository.deleteService(2, 'sample')).rejects.toMatchObject({ status: 409 })
    const exported = { schemaVersion: after.schemaVersion, services: after.services }
    expect(manifest.validateManifest(exported)).toEqual(exported)
    expect(JSON.stringify(exported)).not.toMatch(/editorIds|favorites|revision|audit|approved/)
    vi.resetModules()
    const { installServiceCenterHost } = await import('../../packages/server/src/modules/studio/extensions/service-center/host')
    installServiceCenterHost({ dataRoot: join(home, 'service-center'), actorFor: () => ({ id: superId, role: 'super_admin' }), eligibleAdmin: () => false })
    const restarted = await import('../../packages/server/src/modules/studio/extensions/service-center/catalog')
    expect(await restarted.catalog()).toEqual(after)
    expect((await stat(join(home, 'service-center', 'catalog.json'))).mode & 0o777).toBe(0o600)
  })

  it('enforces active real admin grants, self-escalation denial and same-token revocation', async () => {
    const jwt = await auth.issueUserJwt({ id: readerId, username: 'fixture-reader', role: 'admin' })
    const authenticated = async () => {
      const ctx = context(0, { expectedRevision: 0, service: specimen() })
      ctx.path = '/api/studio/service-center/services'
      ctx.headers = { authorization: `Bearer ${jwt}` }
      await auth.requireUserJwt(ctx as any, async () => { await controller.save(ctx as any) })
      return ctx
    }
    expect((await authenticated()).status).toBe(403)
    const selfGrant = context(readerId, { granted: true }, { id: readerId })
    await controller.changeEditor(selfGrant as any)
    expect(selfGrant.status).toBe(403)
    const grant = context(superId, { granted: true }, { id: readerId })
    await controller.changeEditor(grant as any)
    expect(grant.status).toBe(200)
    expect((await authenticated()).status).toBe(200)
    const revoke = context(superId, { granted: false }, { id: readerId })
    await controller.changeEditor(revoke as any)
    expect((await authenticated()).status).toBe(403)
    expect(users.findUserById(readerId)?.role).toBe('admin')
    const unknown = context(superId, { granted: true }, { id: 99999 })
    await controller.changeEditor(unknown as any)
    expect(unknown.status).toBe(404)
    users.updateUser({ userId: editorId, status: 'disabled' })
    const disabled = context(superId, { granted: true }, { id: editorId })
    await controller.changeEditor(disabled as any)
    expect(disabled.status).toBe(404)
    const state = JSON.parse(await readFile(join(home, 'service-center', 'editors.json'), 'utf8'))
    expect(state.audit.map((entry: any) => entry.action)).toEqual(['grant', 'revoke'])
  })

  it('keeps hidden entries and personal favorites separate from readers and exports', async () => {
    await repository.saveService(0, specimen())
    await repository.saveService(1, { ...specimen('hidden'), enabled: false })
    await repository.setFavorite(readerId, 'sample', true)
    const publicCtx = context(readerId)
    await controller.listCatalog(publicCtx as any)
    expect((publicCtx.body as any).services.map((service: any) => service.id)).toEqual(['sample'])
    expect((publicCtx.body as any).favorites).toEqual(['sample'])
    expect((publicCtx.body as any).capabilities).toEqual({ canManageServices: false, canManageEditors: false })
    const other = context(editorId)
    await controller.listCatalog(other as any)
    expect((other.body as any).favorites).toEqual([])
    const deniedFavorite = context(readerId, { favorite: true }, { id: 'hidden' })
    await controller.favorite(deniedFavorite as any)
    expect(deniedFavorite.status).toBe(404)
    const exported = context(readerId)
    await controller.exportManifest(exported as any)
    expect((exported.body as any).services.map((service: any) => service.id)).toEqual(['sample'])
    expect(JSON.stringify(exported.body)).not.toMatch(/favorites|capabilities|revision|grants/)
  })
})