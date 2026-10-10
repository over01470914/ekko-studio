import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CentralConnection } from '../../packages/server/src/modules/studio/extensions/personal-agent/central'

describe('central canonical session DTO (real repository, isolated SQLite)', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
  it('accepts string/current and normalized numeric/legacy owners and fails closed for missing owner/profile', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pa02-dto-')); vi.stubEnv('HERMES_WEB_UI_TEST_DB_DIR', root); vi.resetModules()
    const { initAllHermesTables } = await import('../../packages/server/src/modules/studio/infrastructure/database/schemas')
    const db = await import('../../packages/server/src/modules/studio/infrastructure/database')
    const store = await import('../../packages/server/src/modules/studio/repositories/session-store')
    initAllHermesTables()
    let detail: ReturnType<typeof store.getSessionDetail>
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(req.url === '/api/auth/me' ? { user: { id: 4, status: 'active', username: 'fixture' } } : req.url === '/api/hermes/profiles' ? { profiles: [{ name: 'naya' }] } : { session: detail }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const config = { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token: 'fixture-only', principalId: 4, profile: 'naya', sessionId: 'authorized-fixture', taskId: 'client-owned-task' }
      // createSession explicitly supports string and legacy numeric inputs; the real wire DTO normalizes both to strings.
      for (const owner of ['4', 4]) {
        store.createSession({ id: config.sessionId, profile: config.profile, user_id: owner })
        detail = store.getSessionDetail(config.sessionId)
        expect(detail?.user_id).toBe('4'); expect(detail).not.toHaveProperty('task_id'); expect(detail).not.toHaveProperty('created_by_user_id')
        const central = new CentralConnection(config)
        expect(await central.state()).toMatchObject({ connected: true, clientTaskId: 'client-owned-task' })
        central.close(); store.deleteSession(config.sessionId)
      }
      for (const owner of [null, '9']) {
        store.createSession({ id: config.sessionId, profile: config.profile, user_id: owner }); detail = store.getSessionDetail(config.sessionId)
        expect(await new CentralConnection(config).state()).toMatchObject({ connected: false, error: 'CENTRAL_IDENTITY' })
        store.deleteSession(config.sessionId)
      }
      store.createSession({ id: config.sessionId, profile: 'other', user_id: '4' }); detail = store.getSessionDetail(config.sessionId)
      expect(await new CentralConnection(config).state()).toMatchObject({ connected: false, error: 'CENTRAL_IDENTITY' })
      if (detail) { delete (detail as Partial<typeof detail>).user_id; detail.profile = 'naya' }
      expect(await new CentralConnection(config).state()).toMatchObject({ connected: false, error: 'CENTRAL_IDENTITY' })
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.closeDb(); rmSync(root, { recursive: true, force: true }) }
  })
})
