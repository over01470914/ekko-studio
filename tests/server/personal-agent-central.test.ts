import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { CentralConnection } from '../../packages/server/src/modules/studio/extensions/personal-agent/central'

const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => { for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve())) })
async function fixture(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler); servers.push(server); server.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}
describe('fixed-origin central connection', () => {
  it('is honestly unconfigured and never infers a local principal', async () => {
    const central = new CentralConnection(null)
    expect(await central.state()).toEqual({ version: 1, configured: false, connected: false })
    await expect(central.history()).rejects.toMatchObject({ code: 'CENTRAL_UNAVAILABLE' })
  })
  it.each(['https://user:password@example.test', 'http://example.test', 'https://example.test/api', 'https://example.test?token=x', 'https://example.test#x'])('rejects unsafe origin %s before any request', origin => {
    expect(() => new CentralConnection({ origin, token: 'central-only', principalId: 4, profile: 'naya', sessionId: 'pilot-session' })).toThrow('CENTRAL_CONFIGURATION')
  })
  it('verifies account/profile/session and uses only the independently bound central credential', async () => {
    const seen: Array<{ path: string; token?: string; profile?: string }> = []
    const origin = await fixture((req, res) => {
      seen.push({ path: req.url!, token: req.headers.authorization, profile: req.headers['x-hermes-profile'] as string })
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(req.url === '/api/auth/me' ? { user: { id: 4, username: 'Owner', role: 'admin', status: 'active' } } :
        req.url === '/api/hermes/profiles' ? { profiles: [{ name: 'naya' }] } :
        { session: { id: 'pilot-session', profile: 'naya', user_id: '4', title: 'Pilot', messages: [{ role: 'assistant', content: 'protocol fixture response' }] } }))
    })
    const central = new CentralConnection({ origin, token: 'central-only', principalId: 4, profile: 'naya', sessionId: 'pilot-session' })
    expect(await central.state()).toMatchObject({ connected: true, principal: { id: 4 }, profile: 'naya', sessionId: 'pilot-session' })
    expect(await central.history()).toMatchObject({ session: { id: 'pilot-session' } })
    expect(seen.every(item => item.token === 'Bearer central-only')).toBe(true)
    expect(seen.every(item => ['/api/auth/me', '/api/hermes/profiles', '/api/studio/sessions/pilot-session'].includes(item.path))).toBe(true)
    expect(JSON.stringify(await central.state())).not.toContain('central-only')
    central.close()
  })
  it('rejects redirect without leaking a credential to the destination', async () => {
    let requests = 0
    const other = await fixture((_req, res) => { requests++; res.end('{}') })
    const origin = await fixture((_req, res) => { res.writeHead(302, { Location: other + '/stolen' }); res.end() })
    const central = new CentralConnection({ origin, token: 'secret', principalId: 4, profile: 'naya', sessionId: 'pilot-session' })
    expect(await central.state()).toMatchObject({ connected: false, error: 'CENTRAL_REDIRECT' })
    expect(requests).toBe(0)
  })
  it.each(['wrong-account', 'wrong-profile', 'wrong-session', 'wrong-owner'])('fails closed for %s', async mismatch => {
    const origin = await fixture((req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(req.url === '/api/auth/me' ? { user: { id: mismatch === 'wrong-account' ? 9 : 4, role: 'admin', status: 'active' } } :
        req.url === '/api/hermes/profiles' ? { profiles: [{ name: mismatch === 'wrong-profile' ? 'default' : 'naya' }] } :
        { session: { id: mismatch === 'wrong-session' ? 'other' : 'pilot-session', profile: 'naya', user_id: mismatch === 'wrong-owner' ? '9' : '4', messages: [] } }))
    })
    const central = new CentralConnection({ origin, token: 'secret', principalId: 4, profile: 'naya', sessionId: 'pilot-session' })
    expect(await central.state()).toMatchObject({ connected: false, error: 'CENTRAL_IDENTITY' })
    await expect(central.history()).rejects.toMatchObject({ code: 'CENTRAL_IDENTITY' })
  })
  it('rejects encoded path escapes', () => {
    for (const sessionId of ['../auth/me', 'a%2fb']) expect(() => new CentralConnection({ origin: 'https://example.test', token: 'secret', principalId: 4, profile: 'naya', sessionId })).toThrow('CENTRAL_CONFIGURATION')
  })
})
