import { describe, expect, it, vi } from 'vitest'
import Router from '@koa/router'
import Koa from 'koa'
import { createServerExtensionRegistry, type ServerExtensionSpec } from '../../packages/server/src/modules/studio/extensions/registry'

const makeSpec = (initialize: ServerExtensionSpec['initialize']): ServerExtensionSpec => ({
  id: 'service-center', version: '1.0.0', contractVersion: 1,
  apiBase: '/api/studio/service-center', capabilities: ['directory'], initialize,
})
const moduleRouter = (path = '/api/studio/service-center/catalog') => {
  const router = new Router()
  router.get(path, ctx => { ctx.body = { ok: true } })
  return router
}
async function listen(registry: ReturnType<typeof createServerExtensionRegistry>) {
  const app = new Koa()
  app.use(async (ctx, next) => {
    if (!ctx.headers.authorization) { ctx.status = 401; return }
    await next()
  })
  app.use(registry.discovery.routes())
  registry.routes.forEach(router => app.use(router.routes()))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
}

describe('Studio extension server boundary', () => {
  it('defaults off without initializing the module, exposing a route or opening storage', async () => {
    const initialize = vi.fn(() => ({ routes: moduleRouter() }))
    const registry = createServerExtensionRegistry([makeSpec(initialize)], [])
    expect(initialize).not.toHaveBeenCalled()
    const app = await listen(registry)
    try {
      expect((await fetch(`${app.origin}/api/studio/extensions`)).status).toBe(401)
      expect(await (await fetch(`${app.origin}/api/studio/extensions`, { headers: { Authorization: 'fixture' } })).json())
        .toEqual({ contractVersion: 1, extensions: [] })
      expect((await fetch(`${app.origin}/api/studio/service-center/catalog`, { headers: { Authorization: 'fixture' } })).status).toBe(404)
    } finally { await app.close() }
  })

  it('advertises only installed modules and protects discovery and module routes together', async () => {
    const registry = createServerExtensionRegistry([makeSpec(() => ({ routes: moduleRouter() }))], ['service-center'])
    const app = await listen(registry)
    try {
      expect((await fetch(`${app.origin}/api/studio/service-center/catalog`)).status).toBe(401)
      const result = await (await fetch(`${app.origin}/api/studio/extensions`, { headers: { Authorization: 'fixture' } })).json()
      expect(result.extensions).toEqual([{ id: 'service-center', version: '1.0.0', apiBase: '/api/studio/service-center', capabilities: ['directory'] }])
      expect((await fetch(`${app.origin}/api/studio/service-center/catalog`, { headers: { Authorization: 'fixture' } })).status).toBe(200)
    } finally { await app.close() }
  })

  it('rolls back an invalid module route and fails closed on init or contract errors', () => {
    const dispose = vi.fn()
    const escape = makeSpec(() => ({ routes: moduleRouter('/api/auth/users'), dispose }))
    const badContract = { ...makeSpec(() => ({ routes: moduleRouter() })), contractVersion: 2 as 1 }
    const broken = makeSpec(() => { throw new Error('sensitive startup failure') })
    for (const spec of [escape, badContract, broken]) {
      const result = createServerExtensionRegistry([spec], ['service-center'])
      expect(result.descriptors).toEqual([])
      expect(result.routes).toEqual([])
      expect(result.failures).toEqual(['service-center'])
    }
    expect(dispose).toHaveBeenCalledOnce()
  })
})
