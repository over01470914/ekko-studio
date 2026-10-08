import { afterEach, describe, expect, it } from 'vitest'
import Koa from 'koa'
import { bodyParser } from '@koa/bodyparser'
import { createServerExtensionRegistry } from '../../packages/server/src/modules/studio/extensions/registry'
import { personalAgentExtension } from '../../packages/server/src/modules/studio/extensions/personal-agent'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes, randomUUID } from 'node:crypto'
import { PersonalReceiver, sha256, matchesSchema } from '../../packages/personal-assistant/src'
import { PersonalAgentService } from '../../packages/server/src/modules/studio/extensions/personal-agent/service'
import { createPersonalAgentRoutes } from '../../packages/server/src/modules/studio/extensions/personal-agent/routes'

const servers: ReturnType<Koa['listen']>[] = []
afterEach(async () => { for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve())) })
async function serve(enabled: boolean, active = true) {
  const registry = createServerExtensionRegistry([personalAgentExtension({
    actorFor: () => active ? 'fixture-owner' : null, createService: () => null,
  })], enabled ? ['personal-agent'] : [])
  const app = new Koa()
  app.use(bodyParser())
  app.use(async (ctx, next) => { if (!ctx.get('authorization')) { ctx.status = 401; return }; await next() })
  app.use(registry.discovery.routes())
  for (const router of registry.routes) app.use(router.routes())
  const server = app.listen(0, '127.0.0.1')
  servers.push(server)
  await new Promise<void>(resolve => server.once('listening', resolve))
  return { registry, origin: `http://127.0.0.1:${(server.address() as { port: number }).port}` }
}
describe('Personal Agent module installation contract', () => {
  it('returns a real restore HTTP envelope matching its generated 200 schema', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pa-restore-wire-'))
    const root = join(base, 'files'); mkdirSync(root)
    writeFileSync(join(root, 'report.txt'), 'real route fixture')
    const token = randomBytes(32).toString('hex')
    const receiver = new PersonalReceiver({ stateRoot: join(base, 'state'), deviceId: 'device', hostname: 'host',
      workspaces: [{ id: 'workspace', ownerId: 'owner', label: 'Fixture', root }], approvals: [{ id: 'grant', ownerId: 'owner',
        sourceDeviceId: 'sender', sourceOrigin: 'http://127.0.0.1:41001', workspaceId: 'workspace', token, capabilities: ['read', 'delete'] }] })
    const service = new PersonalAgentService(receiver, [])
    const app = new Koa(); app.use(bodyParser())
    const router = createPersonalAgentRoutes({ actorFor: () => 'owner', createService: () => service }, service)
    app.use(router.routes())
    const server = app.listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    try {
      const request = { version: 1, operationId: randomUUID(), deviceId: 'device', workspaceId: 'workspace', grantRevision: 1,
        action: 'delete', path: 'report.txt', expectedSha256: sha256(readFileSync(join(root, 'report.txt'))) }
      const confirmation = receiver.confirmDelete('owner', 'sender', request)
      const deleted = receiver.execute(receiver.authenticate(token, 'http://127.0.0.1:41001'), { ...request, confirmationId: confirmation.confirmationId })
      const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/studio/personal-agent/restore`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ receiptId: (deleted.data as any).receiptId }) })
      const data = await response.json()
      const document = JSON.parse(readFileSync('docs/openapi.json', 'utf8'))
      const wireSchema = document.paths['/api/studio/personal-agent/restore'].post.responses['200'].content['application/json'].schema
      const canonicalRefs = JSON.parse(JSON.stringify(document.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'))
      const schema = JSON.parse(JSON.stringify(wireSchema).replaceAll('#/components/schemas/', '#/$defs/'))
      expect(response.status).toBe(200)
      expect(matchesSchema(data, schema, { $defs: canonicalRefs })).toBe(true)
      expect(data).toMatchObject({ action: 'restore', outcome: 'completed', data: { sha256: request.expectedSha256 } })
      expect(readFileSync(join(root, 'report.txt'), 'utf8')).toBe('real route fixture')
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
      service.close(); rmSync(base, { recursive: true, force: true })
    }
  })
  it('defaults off and does not advertise or open personal state', async () => {
    const { origin, registry } = await serve(false)
    expect(registry.descriptors).toEqual([])
    expect((await fetch(`${origin}/api/studio/personal-agent/state`, { headers: { Authorization: 'fixture' } })).status).toBe(404)
  })
  it('exposes honest empty registered state, requiring an active verified owner', async () => {
    const { origin, registry } = await serve(true)
    expect(registry.failures).toEqual([])
    expect(registry.descriptors[0]).toMatchObject({ id: 'personal-agent', version: '0.1.0' })
    expect((await fetch(`${origin}/api/studio/personal-agent/state`)).status).toBe(401)
    const state = await (await fetch(`${origin}/api/studio/personal-agent/state`, { headers: { Authorization: 'fixture' } })).json()
    expect(state).toEqual({ version: 1, configured: false, workspaces: [], peers: [] })
    const inactive = await serve(true, false)
    expect((await fetch(`${inactive.origin}/api/studio/personal-agent/state`, { headers: { Authorization: 'fixture' } })).status).toBe(403)
  })
})
