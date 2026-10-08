import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

// This gate deliberately runs the rebuilt CJS artifact, so hooks schedule real
// filesystem races at the actual syscall boundary, not a mocked filesystem.
const require = createRequire(import.meta.url)
const fs = require('node:fs') as typeof import('node:fs')
const { PersonalReceiver, sha256, limits } = require('../../dist/personal-assistant/index.js')
let native: any
try { native = require('../../dist/personal-assistant/personal-fs.node') } catch {}
const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).reverse().forEach(fn => fn()) })
function fixture() {
  const base = fs.mkdtempSync(join(tmpdir(), 'pa-safety-'))
  cleanup.push(() => fs.rmSync(base, { recursive: true, force: true }))
  const root = join(base, 'workspace'); const outside = join(base, 'outside')
  fs.mkdirSync(root); fs.mkdirSync(outside); fs.mkdirSync(join(root, 'nested'))
  fs.writeFileSync(join(root, 'nested', 'report.txt'), 'allowed original')
  fs.writeFileSync(join(outside, 'report.txt'), 'outside must never be read or changed')
  const token = randomBytes(32).toString('hex')
  const config = { stateRoot: join(base, 'state'), deviceId: 'device', hostname: 'host',
    workspaces: [{ id: 'workspace', ownerId: 'owner', label: 'fixture', root }], approvals: [{ id: 'grant', ownerId: 'owner',
      sourceDeviceId: 'sender', sourceOrigin: 'http://127.0.0.1:41001', workspaceId: 'workspace', token,
      capabilities: ['search', 'read', 'write', 'delete'] }] }
  const receiver = new PersonalReceiver(config)
  cleanup.push(() => receiver.close())
  const peer = receiver.authenticate(token, 'http://127.0.0.1:41001')
  const request = (action: string, extra: Record<string, unknown> = {}): Record<string, any> => ({ version: 1, operationId: randomUUID(), deviceId: 'device', workspaceId: 'workspace', grantRevision: 1, action, ...extra })
  const status = (op: any) => receiver.execute(peer, { version: 1, operationId: op.operationId, deviceId: 'device', workspaceId: 'workspace', grantRevision: 1, action: 'status' }).data.state
  return { base, root, outside, receiver, peer, request, status, config }
}
function hook(object: any, name: string, run: (original: (...args: any[]) => any, args: any[]) => any) {
  const original = object[name]
  object[name] = (...args: any[]) => run(original.bind(object), args)
  cleanup.push(() => { object[name] = original })
}
function attempt(fn: () => any) { try { return fn() } catch { return null } }

describe('PA01 security and applied-state regressions (freshly built artifact)', () => {
  it('preserves exact 64-bit inode identity at the native boundary', () => {
    const f = fixture(); const fd = fs.openSync(f.root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY)
    try {
      const actual = fs.statSync(join(f.root, 'nested'), { bigint: true })
      const entry = native.statAt(fd, 'nested')
      expect(entry.dev).toBe(actual.dev); expect(entry.ino).toBe(actual.ino)
    } finally { fs.closeSync(fd) }
  })
  it('fails closed before state creation when the rebuilt artifact has no native adapter', () => {
    const base = fs.mkdtempSync(join(tmpdir(), 'pa-native-absent-'))
    cleanup.push(() => fs.rmSync(base, { recursive: true, force: true }))
    fs.copyFileSync(require.resolve('../../dist/personal-assistant/index.js'), join(base, 'index.cjs'))
    const probe = spawnSync(process.execPath, ['-e', `
      const {PersonalReceiver} = require(process.argv[1]);
      try { new PersonalReceiver({stateRoot: process.argv[2]}); process.exit(2) }
      catch (error) { if (error.code !== 'PLATFORM_UNVERIFIED') process.exit(3) }
    `, join(base, 'index.cjs'), join(base, 'state')], { encoding: 'utf8' })
    expect(probe.status).toBe(0); expect(fs.existsSync(join(base, 'state'))).toBe(false)
  })
  it.each(['fsync', 'readback', 'receipt'])('keeps applied create unknown across restart after %s failure', failure => {
    const f = fixture(); const file = join(f.root, 'new.txt'); let injected = false
    if (failure === 'fsync') hook(fs, 'fsyncSync', (original, args) => {
      if (!injected && fs.fstatSync(args[0]).isDirectory() && fs.existsSync(file)) {
        injected = true; throw Object.assign(new Error('directory fsync EIO'), { code: 'EIO' })
      }
      return original(...args)
    })
    else if (failure === 'readback') hook(native, 'openAt', (original, args) => {
      if (!injected && args[1] === 'new.txt' && fs.existsSync(file)) {
        injected = true; throw Object.assign(new Error('readback EIO'), { code: 'EIO' })
      }
      return original(...args)
    })
    else hook(f.receiver.store.db, 'prepare', (original, args) => {
      if (args[0].startsWith('UPDATE operations SET state=')) {
        injected = true; throw new Error('receipt write unavailable')
      }
      return original(...args)
    })
    const op = f.request('write', { path: 'new.txt', mode: 'create', content: 'actually committed' })
    expect(f.receiver.execute(f.peer, op).outcome).toBe('unknown'); expect(injected).toBe(true)
    expect(f.status(op)).toBe('unknown'); expect(fs.readFileSync(file, 'utf8')).toBe('actually committed')
    f.receiver.close()
    const reopened = new PersonalReceiver(f.config); cleanup.push(() => reopened.close())
    const peer = reopened.authenticate(f.config.approvals[0].token, f.config.approvals[0].sourceOrigin)
    expect(reopened.execute(peer, f.request('status', { operationId: op.operationId })).data.state).toBe('unknown')
    expect(reopened.execute(peer, op).outcome).toBe('unknown')
    expect(fs.readFileSync(file, 'utf8')).toBe('actually committed')
  })
  it('does not read an outside file when the leaf becomes a symlink at openat', () => {
    const f = fixture(); let scheduled = false
    const file = join(f.root, 'nested/report.txt'); const saved = join(f.root, 'nested/saved.txt')
    hook(native, 'openAt', (original, args) => {
      if (!scheduled && args[1] === 'report.txt') {
        scheduled = true; fs.renameSync(file, saved); fs.symlinkSync(join(f.outside, 'report.txt'), file)
      }
      return original(...args)
    })
    expect(attempt(() => f.receiver.execute(f.peer, f.request('read', { path: 'nested/report.txt' })))).toBe(null)
    expect(scheduled).toBe(true); expect(fs.readFileSync(saved, 'utf8')).toBe('allowed original')
  })
  it.each(['create', 'restore'])('never replaces a leaf symlink inserted at the real %s linkat', action => {
    const f = fixture(); const file = join(f.root, 'nested/report.txt')
    let deleted: any
    if (action === 'restore') {
      const op = f.request('delete', { path: 'nested/report.txt', expectedSha256: sha256(fs.readFileSync(file)) })
      op.confirmationId = f.receiver.confirmDelete('owner', 'sender', op).confirmationId
      deleted = f.receiver.execute(f.peer, op)
    } else fs.unlinkSync(file)
    let scheduled = false
    hook(native, 'linkAt', (original, args) => {
      if (!scheduled) { scheduled = true; fs.symlinkSync(join(f.outside, 'report.txt'), file) }
      return original(...args)
    })
    const result = attempt(() => action === 'restore' ? f.receiver.restore('owner', deleted.data.receiptId) :
      f.receiver.execute(f.peer, f.request('write', { path: 'nested/report.txt', mode: 'create', content: 'bounded bytes' })))
    expect(scheduled).toBe(true); expect(result).toBe(null); expect(fs.lstatSync(file).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(join(f.outside, 'report.txt'), 'utf8')).toBe('outside must never be read or changed')
  })
  it.each(['overwrite', 'delete'])('does not mutate a leaf swapped to a symlink immediately before %s', action => {
    const f = fixture(); let scheduled = false
    const file = join(f.root, 'nested', 'report.txt'); const saved = join(f.root, 'nested', 'saved.txt')
    const expectedSha256 = sha256(fs.readFileSync(file))
    const request = action === 'delete' ? f.request('delete', { path: 'nested/report.txt', expectedSha256 }) :
      f.request('write', { path: 'nested/report.txt', mode: 'overwrite', expectedSha256, content: 'new allowed bytes' })
    if (action === 'delete') request.confirmationId = f.receiver.confirmDelete('owner', 'sender', request).confirmationId
    hook(native || fs, native ? 'renameAt' : 'renameSync', (original, args) => {
      if (!scheduled) {
        scheduled = true; fs.renameSync(file, saved); fs.symlinkSync(join(f.outside, 'report.txt'), file)
      }
      return original(...args)
    })
    const result = attempt(() => f.receiver.execute(f.peer, request))
    expect(scheduled).toBe(true)
    expect(result?.outcome).not.toBe('completed')
    expect(fs.lstatSync(file).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(join(f.outside, 'report.txt'), 'utf8')).toBe('outside must never be read or changed')
    expect(fs.readFileSync(saved, 'utf8')).toBe('allowed original')
  })
  it.each(['root', 'parent'])('detects a persistent %s swap during a real read without exposing outside text', swap => {
    const f = fixture(); let scheduled = false
    const directory = swap === 'root' ? f.root : join(f.root, 'nested')
    const saved = join(f.base, 'detached')
    hook(native || fs, native ? 'openAt' : 'openSync', (original, args) => {
      const file = native ? args[1] : args[0]
      if (!scheduled && typeof file === 'string' && basename(file) === 'report.txt') {
        scheduled = true; fs.renameSync(directory, saved); fs.symlinkSync(f.outside, directory)
      }
      return original(...args)
    })
    try {
      const result = attempt(() => f.receiver.execute(f.peer, f.request('read', { path: 'nested/report.txt' })))
      expect(scheduled).toBe(true)
      expect(result).toBe(null)
    } finally { if (scheduled) { fs.unlinkSync(directory); fs.renameSync(saved, directory) } }
    expect(fs.readdirSync(f.outside)).toEqual(['report.txt'])
  })
  it.each(['root', 'parent'])('contains create/delete/restore across transient %s symlink swaps at actual mutation syscalls', swap => {
    const f = fixture(); let count = 0
    const directory = swap === 'root' ? f.root : join(f.root, 'nested'); const saved = join(f.base, 'detached')
    const schedule = (original: (...args: any[]) => any, args: any[]) => {
      count++; fs.renameSync(directory, saved); fs.symlinkSync(f.outside, directory)
      try { return original(...args) } finally { fs.unlinkSync(directory); fs.renameSync(saved, directory) }
    }
    if (native) { hook(native, 'linkAt', schedule); hook(native, 'renameAt', schedule) }
    else { hook(fs, 'linkSync', schedule); hook(fs, 'renameSync', schedule) }
    const written = f.receiver.execute(f.peer, f.request('write', { path: 'nested/created.txt', mode: 'create', content: 'bounded bytes' }))
    const request = f.request('delete', { path: 'nested/created.txt', expectedSha256: written.data.sha256 })
    request.confirmationId = f.receiver.confirmDelete('owner', 'sender', request).confirmationId
    const deleted = f.receiver.execute(f.peer, request)
    expect(fs.existsSync(join(f.root, 'nested/created.txt'))).toBe(false)
    const restored = f.receiver.restore('owner', deleted.data.receiptId)
    expect(restored.data.sha256).toBe(written.data.sha256)
    expect(fs.readFileSync(join(f.root, 'nested/created.txt'), 'utf8')).toBe('bounded bytes')
    expect(count).toBe(3)
    expect(fs.readdirSync(f.outside)).toEqual(['report.txt'])
    expect(fs.readFileSync(join(f.outside, 'report.txt'), 'utf8')).toBe('outside must never be read or changed')
  })
  it.each(['root', 'parent'])('rejects a persistent %s swap during staging before writing any payload', swap => {
    const f = fixture(); let scheduled = false
    const directory = swap === 'root' ? f.root : join(f.root, 'nested'); const saved = join(f.base, 'detached')
    hook(native, 'openAt', (original, args) => {
      if (!scheduled && args[1].startsWith('.pa-')) {
        scheduled = true; fs.renameSync(directory, saved); fs.symlinkSync(f.outside, directory)
      }
      return original(...args)
    })
    try {
      const op = f.request('write', { path: 'nested/new.txt', mode: 'create', content: 'never outside' })
      expect(attempt(() => f.receiver.execute(f.peer, op))).toBe(null)
      expect(scheduled).toBe(true)
      expect(fs.readdirSync(f.outside)).toEqual(['report.txt'])
    } finally { if (scheduled) { fs.unlinkSync(directory); fs.renameSync(saved, directory) } }
    expect(fs.readdirSync(join(f.root, 'nested'))).toEqual(['report.txt'])
  })
  it.each(['overwrite', 'delete'])('reports unknown after the real %s rename succeeds but its return fails', action => {
    const f = fixture(); let injected = false
    const file = join(f.root, 'nested/report.txt'); const expectedSha256 = sha256(fs.readFileSync(file))
    const op = action === 'delete' ? f.request('delete', { path: 'nested/report.txt', expectedSha256 }) :
      f.request('write', { path: 'nested/report.txt', mode: 'overwrite', content: 'committed overwrite', expectedSha256 })
    if (action === 'delete') op.confirmationId = f.receiver.confirmDelete('owner', 'sender', op).confirmationId
    hook(native || fs, native ? 'renameAt' : 'renameSync', (original, args) => {
      const result = original(...args)
      if (!injected) { injected = true; throw Object.assign(new Error('post-syscall EIO'), { code: 'EIO' }) }
      return result
    })
    expect(f.receiver.execute(f.peer, op).outcome).toBe('unknown')
    expect(f.status(op)).toBe('unknown')
    expect(f.receiver.execute(f.peer, op).outcome).toBe('unknown')
    if (action === 'delete') expect(fs.existsSync(file)).toBe(false)
    else expect(fs.readFileSync(file, 'utf8')).toBe('committed overwrite')
  })
  it('reserves restore durably and reports unknown after applied link/cleanup failure without retry', () => {
    const f = fixture(); const file = join(f.root, 'nested/report.txt')
    const op = f.request('delete', { path: 'nested/report.txt', expectedSha256: sha256(fs.readFileSync(file)) })
    op.confirmationId = f.receiver.confirmDelete('owner', 'sender', op).confirmationId
    const deleted = f.receiver.execute(f.peer, op); let injected = false
    hook(native || fs, native ? 'unlinkAt' : 'unlinkSync', (original, args) => {
      if (!injected) { injected = true; throw Object.assign(new Error('restore cleanup EIO'), { code: 'EIO' }) }
      return original(...args)
    })
    expect(f.receiver.restore('owner', deleted.data.receiptId).outcome).toBe('unknown')
    expect(fs.readFileSync(file, 'utf8')).toBe('allowed original')
    expect(f.receiver.restore('owner', deleted.data.receiptId).outcome).toBe('unknown')
    expect(fs.lstatSync(file).nlink).toBe(2)
  })
  it('does not put staging bytes outside the root during a real temporary parent symlink swap', () => {
    const f = fixture(); let scheduled = false
    const parent = join(f.root, 'nested'); const saved = join(f.root, 'saved')
    const swap = (original: (...args: any[]) => any, args: any[]) => {
      const file = native ? args[1] : args[0]
      if (!scheduled && typeof file === 'string' && basename(file).startsWith('.pa-')) {
        scheduled = true; fs.renameSync(parent, saved); fs.symlinkSync(f.outside, parent)
        try { return original(...args) } finally { fs.unlinkSync(parent); fs.renameSync(saved, parent) }
      }
      return original(...args)
    }
    hook(native || fs, native ? 'openAt' : 'openSync', swap)
    attempt(() => f.receiver.execute(f.peer, f.request('write', { path: 'nested/new.txt', mode: 'create', content: 'payload must stay contained' })))
    expect(scheduled).toBe(true)
    expect(fs.readdirSync(f.outside)).toEqual(['report.txt'])
    expect(fs.readFileSync(join(f.outside, 'report.txt'), 'utf8')).toBe('outside must never be read or changed')
  })
  it('records unknown after create applies but first temp cleanup fails; retry does not dispatch', () => {
    const f = fixture(); let injected = false
    hook(native || fs, native ? 'unlinkAt' : 'unlinkSync', (original, args) => {
      if (!injected && basename(native ? args[1] : args[0]).startsWith('.pa-')) {
        injected = true; throw Object.assign(new Error('scheduled EIO'), { code: 'EIO' })
      }
      return original(...args)
    })
    const op = f.request('write', { path: 'new.txt', mode: 'create', content: 'committed bytes' })
    const result = attempt(() => f.receiver.execute(f.peer, op))
    expect(injected).toBe(true)
    expect(fs.readFileSync(join(f.root, 'new.txt'), 'utf8')).toBe('committed bytes')
    expect(result?.outcome).toBe('unknown')
    expect(f.status(op)).toBe('unknown')
    expect(f.receiver.execute(f.peer, op).outcome).toBe('unknown')
  })
  it('backs off default CJK read to a complete UTF-8 prefix with the full-file hash', () => {
    const f = fixture(); const bytes = Buffer.from('中'.repeat(12000))
    fs.writeFileSync(join(f.root, 'cjk.txt'), bytes)
    const result = f.receiver.execute(f.peer, f.request('read', { path: 'cjk.txt' }))
    expect(result.data).toMatchObject({ size: bytes.length, sha256: sha256(bytes), byteLength: 32766, truncated: true })
    expect(Buffer.byteLength(result.data.text)).toBe(result.data.byteLength)
    expect(result.data.byteLength).toBeLessThanOrEqual(limits.maxReadBytes)
    expect(() => f.receiver.execute(f.peer, f.request('read', { path: 'cjk.txt', length: 32768 }))).toThrow('INVALID_RANGE')
    expect(() => f.receiver.execute(f.peer, f.request('read', { path: 'cjk.txt', offset: 1 }))).toThrow('INVALID_RANGE')
  })
})
