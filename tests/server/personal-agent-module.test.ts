import { afterEach, describe, expect, it } from 'vitest'
import Koa from 'koa'
import { bodyParser } from '@koa/bodyparser'
import { createServerExtensionRegistry } from '../../packages/server/src/modules/studio/extensions/registry'
import { personalAgentExtension } from '../../packages/server/src/modules/studio/extensions/personal-agent'

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
