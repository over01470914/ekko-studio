#!/usr/bin/env node
// Real two-process acceptance. Same-machine loopback only; it does not claim a physical remote host or Windows.
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync, existsSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { randomBytes, randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Fixture state lives in the OS scratch dir so it can never become a repo change.
const stateRoot = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'pa-accept-'))
const children = []
const evidence = { startedAt: new Date().toISOString(), platform: process.platform, claims: 'same-machine loopback protocol acceptance only; no physical Windows or remote device',
  steps: [], targetReadback: {}, artifacts: { stateRoot } }
const sha256 = value => require('node:crypto').createHash('sha256').update(value).digest('hex')
function freePort() { return new Promise(resolve => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)) }) }) }
function rpc(port, payload, credential) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = httpRequest({ host: '127.0.0.1', port, path: '/v1/operations', method: 'POST', headers: {
      Authorization: `Bearer ${credential}`, 'X-Personal-Origin': 'http://127.0.0.1:41001', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
    res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }) } catch { resolve({ status: res.statusCode, body: null }) } }) })
    req.on('error', reject); req.write(body); req.end()
  })
}
function spawnReceiver(configPath) {
  const child = spawn(process.execPath, [join(rootDir, 'dist/personal-assistant/node.js'), configPath], { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  children.push(child)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('receiver ready timeout')), 20000)
    child.on('message', message => { if (message?.event === 'ready') { clearTimeout(timer); resolve({ child, ...message }) } })
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`receiver exited ${code}`)) })
  })
}
async function main() {
  const targetPort = await freePort(); const senderPort = await freePort()
  const targetFiles = join(stateRoot, 'target-files'); mkdirSync(targetFiles, { mode: 0o700 })
  writeFileSync(join(targetFiles, 'report.txt'), 'granite 內容 alpha')
  writeFileSync(join(targetFiles, 'same.txt'), 'target-identity-content')
  const senderFiles = join(stateRoot, 'sender-files'); mkdirSync(senderFiles, { mode: 0o700 })
  writeFileSync(join(senderFiles, 'same.txt'), 'sender-identity-content')
  const targetToken = randomBytes(32).toString('hex'); const senderToken = randomBytes(32).toString('hex')
  const targetConfig = { version: 1, port: targetPort, ownerId: '1', ownerControl: true, receiver: { stateRoot: join(stateRoot, 'target-state'), deviceId: 'target-device', hostname: 'target-host',
    workspaces: [{ id: 'target-workspace', ownerId: '1', label: 'Target device workspace', root: targetFiles }],
    approvals: [{ id: 'inbound-grant', ownerId: '1', sourceDeviceId: 'sender-device', sourceOrigin: 'http://127.0.0.1:41001',
      workspaceId: 'target-workspace', token: targetToken, capabilities: ['search', 'read', 'write', 'delete'] }] } }
  const senderConfig = { version: 1, port: senderPort, ownerId: '1', receiver: { stateRoot: join(stateRoot, 'sender-state'), deviceId: 'sender-device', hostname: 'sender-host',
    workspaces: [{ id: 'sender-workspace', ownerId: '1', label: 'Sender device workspace', root: senderFiles }],
    approvals: [{ id: 'sender-self-grant', ownerId: '1', sourceDeviceId: 'sender-device', sourceOrigin: 'http://127.0.0.1:41001',
      workspaceId: 'sender-workspace', token: senderToken, capabilities: ['search', 'read'] }] } }
  for (const [name, config] of [['target', targetConfig], ['sender', senderConfig]]) {
    const file = join(stateRoot, `${name}.json`)
    writeFileSync(file, JSON.stringify(config), { mode: 0o600 }); chmodSync(file, 0o600)
  }
  const target = await spawnReceiver(join(stateRoot, 'target.json'))
  const sender = await spawnReceiver(join(stateRoot, 'sender.json'))
  evidence.steps.push({ step: 'spawn', targetPid: target.child.pid, senderPid: sender.child.pid, targetOrigin: target.origin, senderOrigin: sender.origin,
    distinctProcesses: target.child.pid !== sender.child.pid, distinctState: join(stateRoot, 'target'), isolatedRoots: { targetFiles, senderFiles } })
  const operation = (action, extra) => ({ version: 1, operationId: randomUUID(), deviceId: 'target-device', workspaceId: 'target-workspace', grantRevision: 1, action, ...extra })
  const search = await rpc(targetPort, operation('search', { query: 'granite', mode: 'content', limit: 5 }), targetToken)
  evidence.steps.push({ step: 'search', match: search.body?.data?.items?.[0], status: search.status })
  const read = await rpc(targetPort, operation('read', { path: 'report.txt' }), targetToken)
  evidence.steps.push({ step: 'read', text: read.body?.data?.text, sha256: read.body?.data?.sha256, status: read.status })
  const write = await rpc(targetPort, operation('write', { path: 'created.txt', mode: 'create', content: 'real two-process write' }), targetToken)
  evidence.steps.push({ step: 'write', sha256: write.body?.data?.sha256, status: write.status })
  evidence.targetReadback.created = readFileSync(join(targetFiles, 'created.txt'), 'utf8')
  const deleteRequest = operation('delete', { path: 'created.txt', expectedSha256: write.body?.data?.sha256 })
  const confirmation = await new Promise((resolve, reject) => {
    const listener = message => { if (message?.event === 'reply' && message.id === 'confirm') { target.child.off('message', listener); message.error ? reject(new Error(message.error)) : resolve(message.result) } }
    target.child.on('message', listener)
    target.child.send({ id: 'confirm', action: 'confirm-delete', sourceDeviceId: 'sender-device', request: deleteRequest })
  })
  const deleted = await rpc(targetPort, { ...deleteRequest, confirmationId: confirmation.confirmationId }, targetToken)
  evidence.steps.push({ step: 'delete', data: deleted.body?.data, status: deleted.status, targetPresent: existsSync(join(targetFiles, 'created.txt')) })
  // Direct writeback inside the target fixture proves the delete really mutated the target root.
  const restore = await new Promise((resolve, reject) => {
    const listener = message => { if (message?.event === 'reply' && message.id === 'restore') { target.child.off('message', listener); message.error ? reject(new Error(message.error)) : resolve({ body: message.result }) } }
    target.child.on('message', listener)
    target.child.send({ id: 'restore', action: 'restore', receiptId: deleted.body?.data?.receiptId })
  })
  evidence.steps.push({ step: 'restore', status: restore.body?.outcome, restored: readFileSync(join(targetFiles, 'created.txt'), 'utf8') })
  evidence.targetReadback.restored = readFileSync(join(targetFiles, 'created.txt'), 'utf8')
  // Real official MCP client over stdio against the same two-node state.
  const client = new Client({ name: 'pa-acceptance-client', version: '0.1.0' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(rootDir, 'dist/personal-assistant/mcp.js'), join(stateRoot, 'mcp.json')],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  const mcpConfig = { version: 1, ownerId: '1', peers: [{ origin: sender.origin, deviceId: 'sender-device', workspaceId: 'sender-workspace', ownerId: '1',
    sourceDeviceId: 'sender-device', sourceOrigin: 'http://127.0.0.1:41001', credential: senderToken },
  { origin: target.origin, deviceId: 'target-device', workspaceId: 'target-workspace', ownerId: '1', sourceDeviceId: 'sender-device',
    sourceOrigin: 'http://127.0.0.1:41001', credential: targetToken }] }
  writeFileSync(join(stateRoot, 'mcp.json'), JSON.stringify(mcpConfig), { mode: 0o600 }); chmodSync(join(stateRoot, 'mcp.json'), 0o600)
  await client.connect(transport)
  const tools = await client.listTools()
  const mcpSearch = await client.callTool({ name: 'personal_search', arguments: operation('search', { query: 'granite', mode: 'content', limit: 5 }) })
  const mcpRead = await client.callTool({ name: 'personal_read', arguments: operation('read', { path: 'report.txt' }) })
  // Identical relative path on two real fixtures must resolve by verified identity, never by name or path.
  const targetSame = await client.callTool({ name: 'personal_read', arguments: operation('read', { path: 'same.txt' }) })
  const senderSame = await client.callTool({ name: 'personal_read', arguments: { version: 1, operationId: randomUUID(), deviceId: 'sender-device',
    workspaceId: 'sender-workspace', grantRevision: 1, action: 'read', path: 'same.txt' } })
  evidence.mcp = { tools: tools.tools.map(tool => tool.name), searchItem: mcpSearch.structuredContent?.data?.items?.[0], readText: mcpRead.structuredContent?.data?.text }
  evidence.identityDifferentiation = { targetDeviceSamePath: targetSame.structuredContent?.data?.text ?? targetSame.content?.[0]?.text,
    senderDeviceSamePath: senderSame.structuredContent?.data?.text ?? senderSame.content?.[0]?.text,
    distinct: targetSame.structuredContent?.data?.sha256 !== senderSame.structuredContent?.data?.sha256 }
  await client.close()
  const serialized = JSON.stringify(evidence)
  for (const secret of [targetToken, senderToken]) if (serialized.includes(secret)) throw new Error('credential leaked into evidence')
  evidence.completedAt = new Date().toISOString()
  writeFileSync(join(stateRoot, 'acceptance-evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
}
main().catch(error => { console.error('ACCEPTANCE_FAILED', error); process.exitCode = 1 })
  .finally(() => { for (const child of children) { try { child.send?.({ action: 'stop' }); child.kill('SIGTERM') } catch {} }
    setTimeout(() => { for (const child of children) try { child.kill('SIGKILL') } catch {}
      if (process.env.PA_KEEP_STATE !== '1') rmSync(stateRoot, { recursive: true, force: true }) }, 500).unref() })
