import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { PersonalReceiver } from '../../packages/personal-assistant/src'
import { createReceiverServer } from '../../packages/personal-assistant/src/http'
import { PersonalClient } from '../../packages/personal-assistant/src/client'
import { createMcpSession } from '../../packages/personal-assistant/src/mcp'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function target() {
  const root = mkdtempSync(join(tmpdir(), 'pa-http-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'files'))
  writeFileSync(join(root, 'files', 'same.txt'), 'target real text')
  const credential = randomBytes(32).toString('hex')
  const receiver = new PersonalReceiver({ deviceId: 'target-device', hostname: 'same-host', stateRoot: join(root, 'state'),
    workspaces: [{ id: 'target-workspace', ownerId: 'owner', label: 'Target', root: join(root, 'files') }],
    approvals: [{ id: 'grant', ownerId: 'owner', sourceDeviceId: 'sender', sourceOrigin: 'http://127.0.0.1:41001',
      workspaceId: 'target-workspace', token: credential, capabilities: ['search', 'read', 'write', 'delete'] }] })
  cleanups.push(() => receiver.close())
  const server = createReceiverServer(receiver)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const config = { origin, deviceId: 'target-device', workspaceId: 'target-workspace', ownerId: 'owner',
    sourceDeviceId: 'sender', sourceOrigin: 'http://127.0.0.1:41001', credential }
  const request = (action: string, extra = {}) => ({ version: 1, operationId: randomUUID(), deviceId: 'target-device', workspaceId: 'target-workspace', grantRevision: 1, action, ...extra })
  return { receiver, config, origin, request, client: new PersonalClient(config) }
}
describe('Receiver HTTP and scoped MCP transport', () => {
  it('uses the real remote receiver, denies unauthenticated/browser/unsupported paths and rechecks an open connection', async () => {
    const f = await target()
    expect((await fetch(`${f.origin}/v1/workspaces`)).status).toBe(401)
    expect((await fetch(`${f.origin}/arbitrary`)).status).toBe(404)
    const headers = { Authorization: `Bearer ${f.config.credential}`, 'X-Personal-Origin': f.config.sourceOrigin, 'Content-Type': 'application/json' }
    expect((await fetch(`${f.origin}/v1/operations`, { method: 'POST', headers: { ...headers, Origin: 'https://browser.example' }, body: '{}' })).status).toBe(403)
    expect((await f.client.execute('owner', f.request('read', { path: 'same.txt' }))).data.text).toBe('target real text')
    expect(() => new PersonalClient({ ...f.config, origin: 'http://example.com' })).toThrow('INVALID_CONFIGURATION')
    await expect(f.client.execute('wrong-owner', f.request('read', { path: 'same.txt' }))).rejects.toThrow('FORBIDDEN')
    f.receiver.setGrant('owner', 'grant', 1, [])
    await expect(f.client.execute('owner', f.request('read', { path: 'same.txt' }))).rejects.toThrow('GRANT_MISMATCH')
  })
  it('rejects credential redirects and does not leak authorization to another origin', async () => {
    const f = await target()
    let leaked = false
    const other = createServer((req, res) => { leaked = !!req.headers.authorization; res.end('{}') })
    await new Promise<void>(resolve => other.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise<void>(resolve => other.close(() => resolve())))
    const redirect = createServer((_req, res) => { res.writeHead(307, { Location: `http://127.0.0.1:${(other.address() as { port: number }).port}` }); res.end() })
    await new Promise<void>(resolve => redirect.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise<void>(resolve => redirect.close(() => resolve())))
    const client = new PersonalClient({ ...f.config, origin: `http://127.0.0.1:${(redirect.address() as { port: number }).port}` })
    await expect(client.execute('owner', f.request('write', { path: 'x.txt', mode: 'create', content: 'x' }))).rejects.toThrow('TRANSPORT_UNKNOWN')
    expect(leaked).toBe(false)
  })
  it('performs actual MCP initialize, listing and real search/read/write/delete/status calls', async () => {
    const f = await target()
    const session = createMcpSession(f.client, 'owner')
    const rpc = (id: number, method: string, params?: unknown) => session.handle({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })
    expect((await rpc(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'real-client', version: '1' } })).result.serverInfo.version).toBe('0.1.0')
    await session.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect((await rpc(2, 'tools/list')).result.tools.map((tool: any) => tool.name)).toEqual(['personal_search', 'personal_read', 'personal_write', 'personal_delete', 'personal_operation_status'])
    const call = async (id: number, name: string, args: unknown) => (await rpc(id, 'tools/call', { name, arguments: args })).result
    const search = await call(3, 'personal_search', f.request('search', { query: 'target', mode: 'content', limit: 5 }))
    expect(search.structuredContent.data.items[0].path).toBe('same.txt')
    expect((await call(4, 'personal_read', f.request('read', { path: 'same.txt' }))).structuredContent.data.text).toBe('target real text')
    const writeRequest = f.request('write', { path: 'mcp.txt', mode: 'create', content: 'real MCP write' })
    const written = (await call(5, 'personal_write', writeRequest)).structuredContent
    const deleteRequest = f.request('delete', { path: 'mcp.txt', expectedSha256: written.data.sha256 })
    const confirmation = f.receiver.confirmDelete('owner', 'sender', deleteRequest)
    expect((await call(6, 'personal_delete', { ...deleteRequest, confirmationId: confirmation.confirmationId })).structuredContent.data.deleted).toBe(true)
    expect((await call(7, 'personal_operation_status', { version: 1, deviceId: writeRequest.deviceId, workspaceId: writeRequest.workspaceId,
      grantRevision: 1, operationId: writeRequest.operationId, action: 'status' })).structuredContent.data.state).toBe('completed')
    const denied = await call(8, 'personal_read', f.request('read', { path: '.env' }))
    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied)).not.toContain(f.config.credential)
  })
})
