import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { request } from 'node:http'
import { createPersonalGateway } from '../../packages/server/src/bootstrap/personal-gateway'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
async function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'pa02-gateway-')); const clientDir = join(base, 'client'); mkdirSync(clientDir)
  const token = randomBytes(32).toString('hex')
  const gateway = createPersonalGateway({ dataRoot: join(base, 'private'), clientDir, ownerId: 'fixture-owner', token, port: 0 })
  const origin = await gateway.listen()
  cleanup.push(async () => { await gateway.close(); rmSync(base, { recursive: true, force: true }) })
  return { base, gateway, origin, token }
}
describe('client-only personal gateway composition', () => {
  it('starts without Hermes config/home/Agent/Bridge and exposes honest authenticated empty state', async () => {
    const { base, origin, token } = await fixture()
    const health = await (await fetch(origin + '/health')).json()
    expect(health).toMatchObject({ status: 'ok', mode: 'personal-gateway', localAgent: false, localBridge: false })
    expect(readdirSync(base)).not.toContain('hermes-home')
    expect((await fetch(origin + '/api/studio/personal-agent/state')).status).toBe(401)
    const headers = { Authorization: `Bearer ${token}` }
    expect(await (await fetch(origin + '/api/studio/personal-agent/state', { headers })).json()).toMatchObject({ configured: false, workspaces: [] })
    expect(await (await fetch(origin + '/api/studio/personal-agent/central/state', { headers })).json()).toMatchObject({ configured: false, connected: false })
    expect((await fetch(origin + '/api/hermes/profiles', { headers })).status).toBe(404)
    expect((await fetch(origin + '/api/studio/personal-agent/onboard', { method: 'POST', headers, body: '{}' })).status).toBe(404)
  })
  it('rejects foreign origins and Host headers even with the native local bearer', async () => {
    const { origin, token } = await fixture()
    expect((await fetch(origin + '/api/studio/personal-agent/state', { headers: { Authorization: `Bearer ${token}`, Origin: 'https://attacker.test' } })).status).toBe(403)
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(origin + '/api/studio/personal-agent/state', { headers: { Authorization: `Bearer ${token}`, Host: 'attacker.test' } }, res => { res.resume(); resolve(res.statusCode) })
      req.on('error', reject); req.end()
    })
    expect(status).toBe(403)
  })
})
