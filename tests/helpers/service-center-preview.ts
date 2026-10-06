// Isolated Service Center acceptance harness. Not the Studio bootstrap: it never
// starts gateways, agent bridges, webhooks, cron, LAN discovery or MCP injection.
// State and fixture JWTs stay outside the checkout and must never be committed.
import { resolve } from 'path'
import { randomBytes } from 'crypto'
import { writeFile, mkdir } from 'fs/promises'

async function main() {
  const stateDir = process.env.HERMES_WEB_UI_HOME
  const tempRoot = process.env.TMPDIR
  if (!stateDir || !tempRoot || !resolve(stateDir).startsWith(resolve(tempRoot) + '/')) {
    throw new Error('Preview requires HERMES_WEB_UI_HOME inside the Hermes scratch directory')
  }
  if (process.env.AUTH_JWT_SECRET || process.env.AUTH_TOKEN) throw new Error('Preview must not inherit auth secrets')
  await mkdir(stateDir, { recursive: true, mode: 0o700 })

  // Import only after env isolation checks: config and SQLite resolve at import time.
  const [{ default: Koa }, { default: Router }, { default: bodyParser }, schemas, users, auth, authController, serviceCenterRoutes] = await Promise.all([
    import('koa'), import('@koa/router'), import('@koa/bodyparser'),
    import('../../packages/server/src/modules/studio/infrastructure/database/schemas'),
    import('../../packages/server/src/modules/studio/repositories/users-store'),
    import('../../packages/server/src/modules/studio/middleware/auth'),
    import('../../packages/server/src/modules/studio/controllers/auth'),
    import('../../packages/server/src/modules/studio/routes/service-center'),
  ])
  schemas.initAllHermesTables()
  const credentials = randomBytes(32).toString('hex')
  const accounts = [
    { username: 'sc-preview-owner', role: 'super_admin' as const },
    { username: 'sc-preview-reader', role: 'admin' as const },
    { username: 'sc-preview-editor', role: 'admin' as const },
  ]
  const fixtureTokens: Record<string, string> = {}
  for (const fixture of accounts) {
    const account = users.findUserByUsername(fixture.username) || users.createUser({ ...fixture, password: credentials })
    if (!account) throw new Error('Could not create isolated preview account')
    fixtureTokens[fixture.username] = await auth.issueUserJwt(account)
  }
  await writeFile(resolve(stateDir, 'preview-tokens.json'), JSON.stringify(fixtureTokens), { mode: 0o600, flag: 'w' })

  const app = new Koa()
  app.use(bodyParser({ encoding: 'utf-8', jsonLimit: '256kb', parsedMethods: ['POST', 'PUT', 'DELETE'] }))
  const publicRoutes = new Router()
  publicRoutes.get('/health/ready', ctx => { ctx.body = { status: 'ready', scope: 'service-center-only' } })
  app.use(publicRoutes.routes())
  app.use(auth.requireUserJwt)
  const protectedRoutes = new Router()
  protectedRoutes.get('/api/auth/me', authController.currentUser)
  protectedRoutes.get('/api/auth/users', auth.requireSuperAdmin, authController.listManagedUsers)
  app.use(protectedRoutes.routes())
  app.use(serviceCenterRoutes.serviceCenterRoutes.routes())
  const port = Number(process.env.PORT || 18671)
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port')
  const host = process.env.BIND_HOST || '127.0.0.1'
  app.listen(port, host, () => console.log(`SERVICE_CENTER_PREVIEW_READY http://${host}:${port}/health/ready`))
}

main().catch(error => { console.error('Service Center preview failed:', error instanceof Error ? error.message : 'unknown'); process.exitCode = 1 })