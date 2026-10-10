import Koa from 'koa'
import { bodyParser } from '@koa/bodyparser'
import { createServer } from 'node:http'
import { createReadStream, realpathSync } from 'node:fs'
import { resolve, join, sep } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { hostname } from 'node:os'
import { createServerExtensionRegistry } from '../modules/studio/extensions/registry'
import { personalAgentExtension } from '../modules/studio/extensions/personal-agent'
import { PersonalWorkspaceService } from '../modules/studio/extensions/personal-agent/workspaces'
import { PersonalCentralStore } from '../modules/studio/extensions/personal-agent/central-store'
import { PersonalError } from '../../../personal-assistant/src'
import type Router from '@koa/router'
type RouteContext = Parameters<ReturnType<Router['routes']>>[0]

export interface PersonalGatewayOptions { dataRoot: string; clientDir: string; ownerId: string; token: string; port: number }
export function createPersonalGateway(options: PersonalGatewayOptions) {
  if (!/^[a-f0-9]{64}$/.test(options.token) || !/^[A-Za-z0-9_-]{1,128}$/.test(options.ownerId) ||
    !Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new PersonalError('INVALID_CONFIGURATION')
  const app = new Koa()
  const server = createServer(app.callback())
  const central = new PersonalCentralStore(join(options.dataRoot, 'central'))
  let files: PersonalWorkspaceService | null = null
  let registry: ReturnType<typeof createServerExtensionRegistry> | null = null
  let origin = ''
  app.use(async (ctx, next) => {
    if (ctx.get('host') !== new URL(origin).host || (ctx.get('origin') && ctx.get('origin') !== origin)) { ctx.status = 403; return }
    ctx.set('Cache-Control', 'no-store')
    if (ctx.path === '/health') { ctx.body = { status: 'ok', mode: 'personal-gateway', version: '0.7.31-personal.1', localAgent: false, localBridge: false }; return }
    if (ctx.path.startsWith('/api/')) {
      const token = ctx.get('authorization').replace(/^Bearer /, '')
      if (token.length !== options.token.length || !timingSafeEqual(Buffer.from(token), Buffer.from(options.token))) { ctx.status = 401; return }
    }
    try { await next() } catch (error) {
      ctx.status = error instanceof PersonalError ? error.status : 500
      ctx.body = { version: 1, error: { code: error instanceof PersonalError ? error.code : 'IO_FAILURE' } }
    }
  })
  app.use(bodyParser({ jsonLimit: '1mb', enableTypes: ['json'], encoding: 'utf-8' }))
  app.use(async (ctx, next) => {
    if (!registry) { ctx.status = 503; return }
    await registry.discovery.routes()(ctx as RouteContext, async () => {
      for (const routes of registry!.routes) {
        await routes.routes()(ctx as RouteContext, async () => {})
        if (ctx.body !== undefined || ctx.respond === false) return
      }
      await next()
    })
  })
  app.use(async ctx => {
    if (ctx.path.startsWith('/api/') || ctx.method !== 'GET') return
    const relative = ctx.path === '/' ? 'personal.html' : ctx.path.slice(1)
    if (!/^[A-Za-z0-9_./-]+$/.test(relative) || relative.split('/').includes('..')) { ctx.status = 404; return }
    try {
      const root = realpathSync(options.clientDir)
      const path = realpathSync(resolve(root, relative))
      if (!path.startsWith(root + sep)) { ctx.status = 404; return }
      ctx.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'")
      ctx.type = path.endsWith('.html') ? 'html' : path.endsWith('.js') ? 'js' : path.endsWith('.css') ? 'css' : path.endsWith('.png') ? 'png' : 'application/octet-stream'
      ctx.body = createReadStream(path)
    } catch { ctx.status = 404 }
  })
  return {
    async listen() {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', resolve) })
      origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
      files = new PersonalWorkspaceService(join(options.dataRoot, 'workspaces'), options.ownerId, origin, hostname())
      registry = createServerExtensionRegistry([personalAgentExtension({ actorFor: () => options.ownerId, createService: () => files, central })], ['personal-agent'])
      if (registry.failures.length) { server.close(); throw new PersonalError('INVALID_CONFIGURATION') }
      return origin
    },
    onboard: (root: string, label: string, capabilities: ('search' | 'read' | 'write' | 'delete')[]) => {
      if (!files) throw new PersonalError('UNAVAILABLE', 503)
      return files.onboard(root, label, capabilities)
    },
    async close() {
      central.close(); files?.close()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

// The native parent owns this private pipe. There is no local inference bootstrap import.
if (require.main === module) {
  if (!process.send) throw new Error('Native parent IPC required')
  process.once('message', async (options: PersonalGatewayOptions) => {
    let gateway: ReturnType<typeof createPersonalGateway> | null = null
    try {
      gateway = createPersonalGateway(options)
      const origin = await gateway.listen()
      process.send?.({ event: 'ready', origin })
      process.on('message', async (message: { event?: string; id?: string; root?: string; label?: string; capabilities?: ('search' | 'read' | 'write' | 'delete')[] }) => {
        if (message.event !== 'onboard' || !message.id) return
        try {
          const workspace = await gateway!.onboard(message.root!, message.label!, message.capabilities!)
          process.send?.({ event: 'reply', id: message.id, workspace })
        } catch (error) { process.send?.({ event: 'reply', id: message.id, error: error instanceof PersonalError ? error.code : 'IO_FAILURE' }) }
      })
      const close = () => { void gateway!.close().finally(() => process.exit(0)) }
      process.once('SIGTERM', close); process.once('SIGINT', close); process.once('disconnect', close)
    } catch { await gateway?.close(); process.send?.({ event: 'failed', code: 'GATEWAY_START_FAILED' }); process.exit(1) }
  })
}
