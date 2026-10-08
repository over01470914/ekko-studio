import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, linkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes, randomUUID } from 'node:crypto'
import { PersonalReceiver, sha256 } from '../../packages/personal-assistant/src'

const roots: string[] = []
const receivers: PersonalReceiver[] = []
afterEach(() => {
  receivers.splice(0).forEach(receiver => receiver.close())
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pa-engine-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  mkdirSync(workspace, { mode: 0o700 })
  writeFileSync(join(workspace, 'report.txt'), 'alpha 真實內容')
  const token = randomBytes(32).toString('hex')
  const options = {
    stateRoot: join(root, 'state'), deviceId: 'receiver-a', hostname: 'same-host',
    workspaces: [{ id: 'workspace-a', ownerId: 'owner-a', label: 'Fixture', root: workspace }],
    approvals: [{ id: 'grant-a', ownerId: 'owner-a', sourceDeviceId: 'sender-a', sourceOrigin: 'http://127.0.0.1:41001',
      workspaceId: 'workspace-a', token, capabilities: ['search', 'read', 'write', 'delete'] as const }],
  }
  const receiver = new PersonalReceiver(options)
  receivers.push(receiver)
  const auth = () => receiver.authenticate(token, 'http://127.0.0.1:41001')
  const request = (action: string, extra: Record<string, unknown> = {}) => ({ version: 1, operationId: randomUUID(),
    deviceId: 'receiver-a', workspaceId: 'workspace-a', grantRevision: 1, action, ...extra })
  const execute = (action: string, extra: Record<string, unknown> = {}) => receiver.execute(auth(), request(action, extra))
  return { root, workspace, receiver, options, auth, token, request, execute }
}

describe('Personal file receiver v1, real private files', () => {
  it('searches filenames and UTF-8 content and reads a bounded range with a full hash', () => {
    const f = fixture()
    expect(f.execute('search', { query: 'report', mode: 'filename', limit: 10 }).data.items[0].path).toBe('report.txt')
    expect(f.execute('search', { query: '真實', mode: 'content', limit: 10 }).data.items[0].path).toBe('report.txt')
    const result = f.execute('read', { path: 'report.txt', offset: 0, length: 5 })
    expect(result.data).toMatchObject({ text: 'alpha', sha256: sha256(Buffer.from('alpha 真實內容')), offset: 0, truncated: true })
    expect(result.target).toEqual({ deviceId: 'receiver-a', hostname: 'same-host', workspaceId: 'workspace-a' })
  })
  it('paginates consistently and binds cursors to query, workspace and grant revision', () => {
    const f = fixture()
    writeFileSync(join(f.workspace, 'report2.txt'), 'alpha two')
    const first = f.execute('search', { query: 'alpha', mode: 'both', limit: 1 })
    expect(first.data).toMatchObject({ hasMore: true, truncated: false })
    const second = f.execute('search', { query: 'alpha', mode: 'both', limit: 1, cursor: first.data.nextCursor })
    expect(second.data).toMatchObject({ hasMore: false, nextCursor: null })
    expect(second.data.items[0].path).not.toBe(first.data.items[0].path)
    expect(() => f.execute('search', { query: 'changed', mode: 'both', limit: 1, cursor: first.data.nextCursor })).toThrow('CURSOR_INVALID')
    f.receiver.setGrant('owner-a', 'grant-a', 1, ['read'])
    expect(() => f.receiver.execute(f.auth(), f.request('search', { query: 'alpha', mode: 'both', limit: 1 }))).toThrow('GRANT_MISMATCH')
  })
  it('distinguishes atomic create-only and compare-hash overwrite, with real readback', () => {
    const f = fixture()
    const created = f.execute('write', { path: 'new.txt', mode: 'create', content: 'new 真實' })
    expect(readFileSync(join(f.workspace, 'new.txt'), 'utf8')).toBe('new 真實')
    expect(created.data.sha256).toBe(sha256(Buffer.from('new 真實')))
    expect(() => f.execute('write', { path: 'new.txt', mode: 'create', content: 'clobber' })).toThrow('CONFLICT')
    expect(() => f.execute('write', { path: 'new.txt', mode: 'overwrite', content: 'changed', expectedSha256: '0'.repeat(64) })).toThrow('CONFLICT')
    const changed = f.execute('write', { path: 'new.txt', mode: 'overwrite', content: 'changed', expectedSha256: created.data.sha256 })
    expect(changed.data.sha256).toBe(sha256(readFileSync(join(f.workspace, 'new.txt'))))
    expect(f.execute('read', { path: 'new.txt' }).data.text).toBe('changed')
  })
  it('requires owner-confirmed exact delete and retains a restorable private receipt', () => {
    const f = fixture()
    const req = f.request('delete', { path: 'report.txt', expectedSha256: sha256(readFileSync(join(f.workspace, 'report.txt'))) })
    expect(() => f.receiver.confirmDelete('other-owner', 'sender-a', req)).toThrow('FORBIDDEN')
    const confirmation = f.receiver.confirmDelete('owner-a', 'sender-a', req)
    expect(() => f.receiver.execute(f.auth(), { ...req, operationId: randomUUID(), path: 'wrong.txt', confirmationId: confirmation.confirmationId })).toThrow()
    const result = f.receiver.execute(f.auth(), { ...req, confirmationId: confirmation.confirmationId })
    expect(result.data).toMatchObject({ deleted: true, restorable: true })
    expect(existsSync(join(f.workspace, 'report.txt'))).toBe(false)
    expect(f.receiver.restore('owner-a', result.data.receiptId).data.sha256).toBe(req.expectedSha256)
    expect(readFileSync(join(f.workspace, 'report.txt'), 'utf8')).toBe('alpha 真實內容')
  })
  it('deduplicates durable payload-bound operation IDs, persists status and never redispatches unknown state', () => {
    const f = fixture()
    const req = f.request('write', { path: 'once.txt', mode: 'create', content: 'once' })
    const first = f.receiver.execute(f.auth(), req)
    expect(f.receiver.execute(f.auth(), req)).toEqual(first)
    expect(() => f.receiver.execute(f.auth(), { ...req, content: 'different' })).toThrow('OPERATION_CONFLICT')
    f.receiver.close()
    const restarted = new PersonalReceiver(f.options)
    receivers.push(restarted)
    const principal = restarted.authenticate(f.token, 'http://127.0.0.1:41001')
    expect(() => restarted.execute(principal, { ...req, action: 'status', path: undefined, mode: undefined, content: undefined })).toThrow('INVALID_REQUEST')
    const status = restarted.execute(principal, { version: 1, operationId: req.operationId, deviceId: req.deviceId,
      workspaceId: req.workspaceId, grantRevision: 1, action: 'status' })
    expect(status.data.state).toBe('completed')
    expect(restarted.execute(principal, req)).toEqual(first)
  })
  it('marks an interrupted pending operation unknown after reopen and does not retry it', () => {
    const f = fixture()
    const req = f.request('write', { path: 'uncertain.txt', mode: 'create', content: 'once' })
    f.receiver.reserveOperation(f.auth(), req)
    f.receiver.close()
    const restarted = new PersonalReceiver(f.options)
    receivers.push(restarted)
    const result = restarted.execute(restarted.authenticate(f.token, 'http://127.0.0.1:41001'), req)
    expect(result.outcome).toBe('unknown')
    expect(existsSync(join(f.workspace, 'uncertain.txt'))).toBe(false)
  })
  it('revokes existing authenticated connections immediately and persists grant revisions', () => {
    const f = fixture()
    const principal = f.auth()
    f.receiver.setGrant('owner-a', 'grant-a', 1, [])
    expect(() => f.receiver.execute(principal, f.request('read', { path: 'report.txt' }))).toThrow('GRANT_MISMATCH')
    expect(() => f.receiver.setGrant('other-owner', 'grant-a', 2, ['read'])).toThrow('FORBIDDEN')
    f.receiver.close()
    const restarted = new PersonalReceiver(f.options)
    receivers.push(restarted)
    expect(restarted.stateFor('owner-a').workspaces[0].grantRevision).toBe(2)
    expect(restarted.stateFor('other-owner').workspaces).toEqual([])
  })
  it('does not leak private roots or credentials in state or errors', () => {
    const f = fixture()
    const state = JSON.stringify(f.receiver.stateFor('owner-a'))
    expect(state).not.toContain(f.workspace)
    expect(state).not.toContain(f.token)
    expect(() => f.receiver.authenticate('wrong', 'http://127.0.0.1:41001')).toThrow('UNAUTHORIZED')
    expect(() => f.receiver.authenticate(f.token, 'http://127.0.0.1:41002')).toThrow('UNAUTHORIZED')
    expect(() => f.receiver.execute({ ownerId: 'owner-a', sourceDeviceId: 'sender-a', grantId: 'grant-a' } as any,
      f.request('read', { path: 'report.txt' }))).toThrow('UNAUTHORIZED')
  })
  it.each(['../outside.txt', '/etc/passwd', 'C:/secret.txt', '//host/share', '\\host\\share', 'report.txt:stream',
    '.', 'a/../report.txt', 'a//b', '%2e%2e/outside', 'a\\b', 'CON', 'report.txt.'])('denies unsafe path %s', path => {
    const f = fixture()
    expect(() => f.execute('read', { path })).toThrow()
  })
  it('denies leaf/parent symlinks, hardlinks, directories and state/root overlap', () => {
    const f = fixture()
    const outside = join(f.root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'outside.txt'), 'outside')
    symlinkSync(outside, join(f.workspace, 'parent'))
    symlinkSync(join(outside, 'outside.txt'), join(f.workspace, 'leaf.txt'))
    linkSync(join(outside, 'outside.txt'), join(f.workspace, 'hard.txt'))
    for (const path of ['parent/outside.txt', 'leaf.txt', 'hard.txt', 'parent']) expect(() => f.execute('read', { path })).toThrow()
    expect(() => f.execute('write', { path: 'parent/new.txt', mode: 'create', content: 'escape' })).toThrow()
    f.receiver.close()
    expect(() => new PersonalReceiver({ ...f.options, stateRoot: join(f.workspace, 'private') })).toThrow('INVALID_CONFIGURATION')
  })
  it('rejects sensitive names and contents without leaking even their search results', () => {
    const f = fixture()
    writeFileSync(join(f.workspace, '.env'), 'ordinary')
    writeFileSync(join(f.workspace, 'report-secret.txt'), 'api_key="sk-test-sensitive-1234567890"')
    writeFileSync(join(f.workspace, 'late.txt'), 'ordinary\n'.repeat(4000) + '-----BEGIN PRIVATE KEY-----')
    for (const path of ['.env', 'report-secret.txt', 'late.txt']) expect(() => f.execute('read', { path, length: 8 })).toThrow('SENSITIVE_FILE')
    const result = f.execute('search', { query: 'report', mode: 'both', limit: 100 })
    expect(result.data.items.map((item: any) => item.path)).toEqual(['report.txt'])
    expect(() => f.execute('write', { path: 'secret.txt', mode: 'create', content: 'password="sensitive-value"' })).toThrow('SENSITIVE_FILE')
  })
  it.each([[], null, { action: 'exec' }, { version: 2 }, { unexpected: true }])('rejects malformed/unsupported containers %j', value => {
    const f = fixture()
    expect(() => f.receiver.execute(f.auth(), value)).toThrow('INVALID_REQUEST')
  })
  it('checks wrong device/workspace/grant and per-operation capabilities', () => {
    const f = fixture()
    for (const extra of [{ deviceId: 'other' }, { workspaceId: 'other' }, { grantRevision: 2 }]) {
      expect(() => f.execute('read', { path: 'report.txt', ...extra })).toThrow()
    }
    f.receiver.setGrant('owner-a', 'grant-a', 1, ['read'])
    expect(() => f.execute('write', { path: 'denied.txt', mode: 'create', content: 'a', grantRevision: 2 })).toThrow('CAPABILITY_DENIED')
  })
  it('enforces file/write/read/query bounds and returns truthful scan truncation', () => {
    const f = fixture()
    writeFileSync(join(f.workspace, 'large.txt'), 'x'.repeat(65537))
    expect(() => f.execute('read', { path: 'large.txt' })).toThrow('LIMIT_EXCEEDED')
    expect(() => f.execute('write', { path: 'large-write.txt', mode: 'create', content: '中'.repeat(30000) })).toThrow('LIMIT_EXCEEDED')
    expect(() => f.execute('read', { path: 'report.txt', length: 32769 })).toThrow('INVALID_REQUEST')
    expect(() => f.execute('search', { query: 'x'.repeat(129), mode: 'both', limit: 1 })).toThrow('INVALID_REQUEST')
    for (let i = 0; i < 1010; i++) writeFileSync(join(f.workspace, `entry-${i}.txt`), 'alpha')
    const result = f.execute('search', { query: 'alpha', mode: 'content', limit: 100 })
    expect(result.data.truncated).toBe(true)
    expect(result.data.scannedEntries).toBeLessThanOrEqual(1000)
  })
})
