import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import Koa from 'koa'
import { bodyParser } from '@koa/bodyparser'
import type { Server } from 'node:http'

const routeSource = readFileSync(new URL('../../packages/server/src/modules/studio/routes/sessions.ts', import.meta.url), 'utf8')
const unrelatedHandlers = (prefix: string) => Object.fromEntries(
  [...routeSource.matchAll(new RegExp(`${prefix}\\.(\\w+)`, 'g'))].map(match => [match[1], async () => {}]),
)
describe('Kanban session HTTP contract with isolated native SQLite', () => {
  let db: DatabaseSync, server: Server, origin: string, user: any, svc: any, task: any
  let setActive: (service: any) => void, events: any[]
  beforeEach(async () => {
    vi.resetModules(); db = new DatabaseSync(':memory:')
    vi.doMock('../../packages/server/src/modules/studio/infrastructure/database/index', () => ({
      getDb: () => db, getStoragePath: () => ':memory:', isSqliteAvailable: () => true,
    }))
    // Keep unrelated session/voice endpoints inert; exercise the actual session router and Kanban controller/service/store.
    vi.doMock('../../packages/server/src/modules/studio/controllers/sessions', () => unrelatedHandlers('ctrl'))
    vi.doMock('../../packages/server/src/modules/studio/controllers/session-shares', () => unrelatedHandlers('shares'))
    const { initAllHermesTables } = await import('../../packages/server/src/modules/studio/infrastructure/database/schemas')
    initAllHermesTables()
    const { createUser } = await import('../../packages/server/src/modules/studio/repositories/users-store')
    user = createUser({ username: 'http-owner', password: 'test', profiles: ['work', 'worker'] })!
    const { createSession } = await import('../../packages/server/src/modules/studio/repositories/session-store')
    createSession({ id: 'owned', profile: 'work', user_id: user.id, source: 'builtin_agent', agent: 'ekko-agent' })
    createSession({ id: 'other', profile: 'work', user_id: user.id + 99 })
    const { createKanbanMilestoneService, setKanbanMilestoneService } = await import('../../packages/server/src/modules/studio/services/notifications/kanban-milestones')
    setActive = setKanbanMilestoneService; events = []
    task = { id: 'task', assignee: 'worker', status: 'blocked', block_kind: 'capability' }
    svc = createKanbanMilestoneService({
      listBoards: async () => [{ slug: 'board', archived: false }], getTask: async () => task,
      latestEventId: () => events.at(-1)?.id || 0, events: (_b, _t, after) => events.filter(e => e.id > after),
    }, async () => false)
    setActive(svc)
    const { sessionRoutes } = await import('../../packages/server/src/modules/studio/routes/sessions')
    const app = new Koa(); app.use(bodyParser())
    app.use(async (ctx, next) => {
      ctx.state.user = ctx.headers['x-no-user'] ? undefined : user
      ctx.state.profile = { name: 'work' }
      ctx.state.runCredential = ctx.headers['x-run-auth'] === '1'
      await next()
    })
    app.use(sessionRoutes.routes()); app.use(sessionRoutes.allowedMethods())
    server = app.listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    origin = `http://127.0.0.1:${(server.address() as any).port}`
  })
  afterEach(async () => {
    setActive(null)
    if (server) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()))
    db.close()
    vi.doUnmock('../../packages/server/src/modules/studio/infrastructure/database/index')
    vi.doUnmock('../../packages/server/src/modules/studio/controllers/sessions')
    vi.doUnmock('../../packages/server/src/modules/studio/controllers/session-shares')
    vi.resetModules()
  })
  async function request(method: string, suffix = '', body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(`${origin}/api/studio/sessions/owned/kanban-notifications${suffix}`, {
      method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }
  it('exposes actual capability state and never allows run credentials to read it', async () => {
    const capability = () => fetch(origin + '/api/studio/kanban-reporting')
    expect(await (await capability()).json()).toEqual({ enabled: true, diagnosticsEnabled: true })
    setActive(null)
    expect(await (await capability()).json()).toEqual({ enabled: false, diagnosticsEnabled: false })
    expect((await fetch(origin + '/api/studio/kanban-reporting', { headers: { 'x-run-auth': '1' } })).status).toBe(401)
    expect((await request('POST', '', { board: 'board', task_id: 'task' })).status).toBe(503)
  })
  it('rejects diagnostic opt-in when only notifications are enabled', async () => {
    const { createKanbanMilestoneService } = await import('../../packages/server/src/modules/studio/services/notifications/kanban-milestones')
    setActive(createKanbanMilestoneService({
      listBoards: async () => [{ slug: 'board', archived: false }], getTask: async () => task,
      latestEventId: () => 0, events: () => [],
    }))
    expect(await (await fetch(origin + '/api/studio/kanban-reporting')).json()).toEqual({ enabled: true, diagnosticsEnabled: false })
    expect(await request('POST', '', { board: 'board', task_id: 'task', wake_enabled: true })).toEqual({
      status: 409, body: { error: 'kanban_diagnostics_disabled' },
    })
    expect((await request('POST', '', { board: 'board', task_id: 'task' })).status).toBe(200)
  })
  it('GET/POST/DELETE roundtrip, latest cursor, wake default false, internal cursor cannot be forged over HTTP', async () => {
    events = [{ id: 1, kind: 'created', occurred_at: Date.now() / 1000, from_review: false }]
    const posted = await request('POST', '', { board: 'board', task_id: 'task', startCursor: 0, userId: 999 })
    expect(posted).toMatchObject({ status: 200, body: { board: 'board', task_id: 'task', active: true, wake_enabled: false } })
    await svc.pollOnce()
    expect((await request('GET')).body.notifications).toEqual([])
    events.push({ id: 2, kind: 'completed', occurred_at: Date.now() / 1000, from_review: true })
    await svc.pollOnce()
    const listed = await request('GET')
    expect(listed.status).toBe(200)
    expect(listed.body.notifications[0]).toMatchObject({ event_id: 2, label: 'QA PASS: task completed', actor: 'kanban/native' })
    const opted = await request('POST', '', { board: 'board', task_id: 'task', wake_enabled: true })
    expect(opted.body).toMatchObject({ id: posted.body.id, wake_enabled: true })
    expect(await request('DELETE', `/${posted.body.id}`)).toEqual({ status: 200, body: { ok: true } })
    expect((await request('GET')).body.subscriptions[0].active).toBe(false)
  })
  it.each(['GET','POST','DELETE'])('rejects run credentials and missing browser user on %s', async method => {
    const suffix = method === 'DELETE' ? '/1' : ''
    const body = method === 'POST' ? { board: 'board', task_id: 'task' } : undefined
    expect(await request(method, suffix, body, { 'x-run-auth': '1' })).toEqual({ status: 401, body: { error: 'unauthorized' } })
    expect(await request(method, suffix, body, { 'x-no-user': '1' })).toEqual({ status: 401, body: { error: 'unauthorized' } })
  })
  it('rejects awake on non-Ekko sessions but still permits zero-token notices', async () => {
    const { getDb } = await import('../../packages/server/src/modules/studio/infrastructure/database/index')
    getDb()!.prepare("UPDATE sessions SET agent='hermes', source='cli' WHERE id='owned'").run()
    expect((await request('POST', '', { board: 'board', task_id: 'task' })).status).toBe(200)
    expect(await request('POST', '', { board: 'board', task_id: 'task', wake_enabled: true })).toEqual({ status: 400, body: { error: 'kanban_awake_unsupported_runtime' } })
  })
  it('validates wake boolean, ids and empty keys', async () => {
    for (const body of [{ board: '', task_id: 'task' }, { board: 'board', task_id: ' ' },
      { board: 'board', task_id: 'task', wake_enabled: 'true' }, { board: 'board', task_id: 'task', wake_enabled: 1 }])
      expect((await request('POST', '', body)).status).toBe(400)
    expect((await request('DELETE', '/nope')).status).toBe(400)
    expect((await request('DELETE', '/999')).status).toBe(404)
  })
  it('rejects forged profile/task and foreign owner even when session id is known', async () => {
    expect((await request('POST', '?profile=worker', { board: 'board', task_id: 'task' })).status).toBe(403)
    expect((await request('POST', '', { board: 'board', task_id: 'other-task' })).status).toBe(403)
    task.assignee = 'secret'
    expect((await request('POST', '', { board: 'board', task_id: 'task' })).status).toBe(403)
    const foreign = await fetch(`${origin}/api/studio/sessions/other/kanban-notifications`)
    expect(foreign.status).toBe(403)
  })
  it('returns 503 when bootstrap has not bound a service; GET also hides revoked task notices', async () => {
    const posted = await request('POST', '', { board: 'board', task_id: 'task', wake_enabled: true })
    events = [{ id: 1, kind: 'gave_up', occurred_at: Date.now() / 1000, from_review: false }]
    await svc.pollOnce(); task.assignee = 'secret'
    const revoked = await request('GET')
    expect(revoked.body.notifications).toEqual([])
    expect(revoked.body.subscriptions[0]).toMatchObject({ id: posted.body.id, active: false, last_error: 'authorization_revoked' })
    setActive(null)
    expect(await request('GET')).toEqual({ status: 503, body: { error: 'kanban_milestones_unavailable' } })
  })
})
