import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

const script = resolve('scripts/migrate-avatar-library-r3.mjs')
const names = ['default', 'orchestrator', 'artist', 'game-designer', 'technical-artist', 'software-engineer', 'quality-engineer', 'platform-engineer', 'shipping', 'developer', 'qa', 'codex-proxy']
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const ref = (id: string) => JSON.stringify({ type: 'library', assetId: id, revision: 3 })
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'avatar-mcp-')); roots.push(root)
  const bytes = Buffer.from([0, 255, 13, 129, 17, 4])
  const sha = hash(bytes)
  const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`
  const image = JSON.stringify({ type: 'image', dataUrl })
  const profileData = names.map(name => ({ name, avatar: { type: 'image', url: `/api/hermes/profiles/${name}/avatar/image/${sha}`, mime: 'image/png' } }))
  const roster = names.slice(0, 9).map((profile, i) => ({ id: `row-${i}`, agentId: `agent-${i}`, profile, ownerMemberId: 'auth:1' }))
  const room = roster.map(item => ({ ...item, avatar: image }))
  const members = [
    { id: 'owner', userId: 'auth:1', authUserId: 1, avatar: image },
    { id: 'removed', userId: 'agent-2', authUserId: null, avatar: image },
    { id: 'custom', userId: 'agent-3', authUserId: null, avatar: JSON.stringify({ type: 'image', dataUrl: 'data:image/png;base64,Y3VzdG9t' }) },
    { id: 'other-account', userId: 'auth:2', authUserId: 2, avatar: image },
  ]
  const inventory = join(root, 'inventory.json')
  const catalog = join(root, 'catalog.json')
  writeFileSync(inventory, JSON.stringify({ roomId: 'muzvuy30vy9c4k', count: 9, roster }))
  writeFileSync(catalog, JSON.stringify({ revision: 2, profiles: names.slice(0, 11).map(profile => ({ profile, sha256: sha })) }))
  const recovery = join(root, 'recovery'); mkdirSync(recovery, { mode: 0o700 })
  return { root, sha, dataUrl, image, profileData, room, members, inventory, catalog, recovery }
}

type Fixture = ReturnType<typeof fixture>
async function run(mode: string, f: Fixture, opts: { failAt?: string; drift?: boolean; status?: number } = {}) {
  const args = [script, mode, '--origin=https://localhost:8648', '--user-id=1', `--roster=${f.inventory}`, `--recovery-dir=${f.recovery}`, `--r2-catalog=${f.catalog}`, `--account-avatar-sha256=${f.sha}`, `--codex-proxy-avatar-sha256=${f.sha}`]
  const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
  let output = '', error = '', writes = 0
  child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { error += chunk })
  for await (const line of createInterface({ input: child.stdout })) {
    const message = JSON.parse(line)
    if (message.kind !== 'mcp-request') { output = line; continue }
    const { path, method, body } = message
    let payload: any = {}
    let status = opts.status || 200
    if (path === '/api/auth/me') payload = { user: { id: 1 } }
    else if (path === '/api/hermes/profiles') payload = { profiles: f.profileData }
    else if (path.endsWith('/agents')) payload = { agents: f.room }
    else if (path === '/api/auth/avatar') {
      if (method === 'PUT') { f.image = body.avatar; writes++ }
      payload = { avatar: f.image }
    } else if (path.endsWith('/members/me/avatar')) {
      if (method === 'PUT') {
        if (body.previousAvatar !== f.members[0].avatar) status = 409
        else { f.members[0].avatar = body.avatar; writes++ }
      }
      payload = { id: 'owner', avatar: f.members[0].avatar }
    } else if (path.endsWith('/member-avatar-snapshots')) payload = { snapshots: f.members }
    else if (path.includes('/member-avatar-snapshots/')) {
      const row = f.members.find(item => item.id === path.split('/').at(-1))!
      if (body.previousAvatar !== row.avatar) status = 409
      else { row.avatar = body.avatar; writes++ }
      payload = { snapshot: row }
    } else if (path.includes('/migration-snapshot/')) payload = { sha256: f.sha, mime: 'image/png', dataUrl: f.dataUrl }
    else if (path.includes('/profiles/') && path.endsWith('/avatar')) {
      const name = decodeURIComponent(path.split('/')[4]); const profile = f.profileData.find(item => item.name === name)!
      if (method === 'PUT') {
        if (body.type === 'library') profile.avatar = { type: 'library', assetId: body.assetId, revision: 3 } as any
        else profile.avatar = { type: 'image', url: `/api/hermes/profiles/${name}/avatar/image/${f.sha}` } as any
        writes++
      }
      payload = { avatar: profile.avatar }
    } else if (path.includes('/agents/')) {
      const row = f.room.find(item => item.agentId === path.split('/').at(-2))!
      if (method === 'PUT') {
        if (body.previousAvatar !== row.avatar) status = 409
        else { row.avatar = body.avatar; writes++ }
      }
      payload = { agent: row }
    } else throw new Error(`Unexpected request ${method} ${path}`)
    if (opts.failAt === path && method === 'PUT') status = 409
    if (status !== 200) payload = { error: 'test failure' }
    child.stdin.write(JSON.stringify({ id: message.id, status, body: payload }) + '\n')
  }
  const code = await new Promise<number>(resolve => child.on('exit', code => resolve(code ?? -1)))
  return { code, output: output ? JSON.parse(output) : null, error, writes }
}

describe('opaque native JSON migration protocol', () => {
  it('plans without writes and refuses incomplete/error envelopes', async () => {
    const f = fixture()
    const planned = await run('plan', f)
    expect(planned.code).toBe(0); expect(planned.writes).toBe(0)
    expect(planned.output).toMatchObject({ memberSnapshots: 4, unresolved: 2 })
    const denied = await run('plan', f, { status: 401 })
    expect(denied.code).not.toBe(0); expect(denied.error).toContain('HTTP 401')
  })
  it('keeps byte-exact private recovery and restores removed snapshots without changing custom/other accounts', async () => {
    const f = fixture(); const oldCustom = f.members[2].avatar, oldOther = f.members[3].avatar
    const applied = await run('apply', f)
    expect(applied.code, applied.error).toBe(0)
    expect(f.members[1].avatar).toBe(ref('ip-003'))
    expect(f.members[2].avatar).toBe(oldCustom); expect(f.members[3].avatar).toBe(oldOther)
    const backup = join(f.recovery, 'avatar-library-r3-user-1.json')
    expect(statSync(backup).mode & 0o777).toBe(0o600)
    const saved = JSON.parse(readFileSync(backup, 'utf8'))
    expect(Buffer.from(saved.profiles[0].avatar.dataUrl.split(',')[1], 'base64')).toEqual(Buffer.from([0, 255, 13, 129, 17, 4]))
    const rolled = await run('rollback', f)
    expect(rolled.code, rolled.error).toBe(0)
    expect(f.members[1].avatar).toBe(saved.memberSnapshots[1].avatar)
    expect(f.profileData[0].avatar.url).toBe(`/api/hermes/profiles/default/avatar/image/${f.sha}`)
  })
  it('leaves recovery for partial failure and refuses entire rollback on drift', async () => {
    const f = fixture()
    const failed = await run('apply', f, { failAt: '/api/auth/avatar' })
    expect(failed.code).not.toBe(0)
    expect(statSync(join(f.recovery, 'avatar-library-r3-user-1.json')).mode & 0o777).toBe(0o600)
    f.members[1].avatar = 'human changed'
    const writesBefore = f.profileData.map(item => item.avatar)
    const rolled = await run('rollback', f)
    expect(rolled.code).not.toBe(0); expect(rolled.error).toContain('Historical snapshot drift')
    expect(f.profileData.map(item => item.avatar)).toEqual(writesBefore)
  })
})
