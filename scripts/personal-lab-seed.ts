// Lab-only account initialization; do not run against an existing Studio home.
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function main() {
  const root = process.env.PERSONAL_LAB_ROOT
  const home = process.env.HERMES_WEB_UI_HOME
  if (!root || !home || resolve(home) !== resolve(root, 'studio-home') || process.env.NODE_ENV !== 'production') {
    throw new Error('Explicit isolated production-mode lab home is required')
  }
  if (process.env.AUTH_TOKEN || process.env.AUTH_JWT_SECRET) throw new Error('Lab must not inherit credentials')
  await mkdir(home, { recursive: true, mode: 0o700 })
  const [schemas, users, auth, database] = await Promise.all([
    import('../packages/server/src/modules/studio/infrastructure/database/schemas'),
    import('../packages/server/src/modules/studio/repositories/users-store'),
    import('../packages/server/src/modules/studio/middleware/auth'),
    import('../packages/server/src/modules/studio/infrastructure/database'),
  ])
  schemas.initAllHermesTables()
  if (users.countUsers() > 0) throw new Error('Refusing to reseed an existing account database')
  const username = 'personal-lab-owner'
  const password = randomBytes(40).toString('base64url')
  const user = users.createUser({ username, password, role: 'super_admin', status: 'active', profiles: ['default'], defaultProfile: 'default' })
  if (!user) throw new Error('Isolated account creation failed')
  const token = await auth.issueUserJwt(user)
  await writeFile(resolve(root, 'lab-credentials.json'), JSON.stringify({ username, password, token }), { mode: 0o600, flag: 'wx' })
  database.closeDb()
  console.log(JSON.stringify({ initialized: true, accounts: 1, defaultCredentialsDisabled: true, home }))
}
// Imported runtime modules may retain timers; this seed owns no service.
main().then(() => process.exit(0)).catch(() => {
  console.error('Personal lab seed failed; inspect isolated state, not production')
  process.exit(1)
})
