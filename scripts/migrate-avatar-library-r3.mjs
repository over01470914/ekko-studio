#!/usr/bin/env node
// Scoped, authenticated avatar-only migration. Nothing writes during plan; recovery is mandatory for apply.
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, open } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createInterface } from 'node:readline'

const roomId = 'muzvuy30vy9c4k'
const originalProfiles = ['default', 'orchestrator', 'artist', 'game-designer', 'technical-artist', 'software-engineer', 'quality-engineer', 'platform-engineer', 'shipping', 'developer', 'qa']
const accountAssetId = 'ip-012'
const revision = 3
const mode = process.argv[2] || 'plan'
const opts = Object.fromEntries(process.argv.slice(3).map(arg => { const [key, ...value] = arg.split('='); return [key, value.join('=')] }))
const origin = opts['--origin']
const recoveryDir = opts['--recovery-dir'] ? resolve(opts['--recovery-dir']) : ''
// The maintenance owner forwards these JSON requests through the native
// ekko_studio_api_request MCP tool (profile=default, token omitted). No bearer crosses this process.
const reader = createInterface({ input: process.stdin, crlfDelay: Infinity })
const lines = reader[Symbol.asyncIterator]()
const expectedUserId = Number(opts['--user-id'])
const rosterPath = opts['--roster']
const profileNames = [...originalProfiles, 'codex-proxy'] // Stopped profiles are metadata only; never start them.
const idFor = name => {
  const index = originalProfiles.indexOf(name)
  return index >= 0 ? `ip-${String(index + 1).padStart(3, '0')}` : name === 'codex-proxy' ? 'ip-013' : null
}
const ref = assetId => ({ type: 'library', assetId, revision })
const roomRef = assetId => JSON.stringify(ref(assetId))
const sha = data => createHash('sha256').update(data).digest('hex')
function assert(condition, message) { if (!condition) throw new Error(message) }
assert(['plan', 'apply', 'rollback'].includes(mode), 'Mode must be plan, apply or rollback')
assert(origin && /^https?:\/\/[^/]+\/?$/.test(origin), '--origin must be an exact HTTP(S) origin')

assert(Number.isSafeInteger(expectedUserId) && expectedUserId > 0, '--user-id must be the previously authorized /me ID')
assert(recoveryDir && rosterPath, '--recovery-dir and --roster are mandatory')
if (mode !== 'plan') assert(opts['--r2-catalog'], 'Apply/rollback require approved --r2-catalog')
if (mode === 'apply') assert(/^[a-f0-9]{64}$/.test(opts['--account-avatar-sha256'] || '') && /^[a-f0-9]{64}$/.test(opts['--codex-proxy-avatar-sha256'] || ''), 'Apply requires exact account and codex-proxy approved hashes')
const base = origin.replace(/\/$/, '')
async function request(path, method = 'GET', body) {
  assert(path.startsWith('/api/') && !path.startsWith('//'), 'Only same-origin API requests allowed')
  const id = ++request.sequence
  process.stdout.write(JSON.stringify({ kind: 'mcp-request', id, profile: 'default', method, path, ...(body === undefined ? {} : { body }) }) + '\n')
  const next = await lines.next()
  assert(!next.done, 'MCP bridge closed before response')
  let envelope
  try { envelope = JSON.parse(next.value) } catch { throw new Error('Invalid MCP JSON response') }
  assert(envelope.id === id && Number.isInteger(envelope.status), 'MCP response id/status mismatch')
  if (envelope.status < 200 || envelope.status >= 300) throw new Error(`${method} ${path}: HTTP ${envelope.status}`)
  assert(envelope.body && typeof envelope.body === 'object' && !Array.isArray(envelope.body), `${method} ${path}: expected complete JSON body`)
  return envelope.body
}
request.sequence = 0
const avatarPath = '/api/auth/avatar'
const agentsPath = `/api/studio/group-chat/rooms/${roomId}/agents`
const memberPath = `/api/studio/group-chat/rooms/${roomId}/members/me/avatar`
const snapshotsPath = `/api/studio/group-chat/rooms/${roomId}/member-avatar-snapshots`
const profilePath = name => `/api/hermes/profiles/${encodeURIComponent(name)}/avatar`
const agentPath = id => `${agentsPath}/${encodeURIComponent(id)}/avatar`
const me = (await request('/api/auth/me')).user
assert(me?.id === expectedUserId, 'Authenticated user is not the expected account')
const inventory = JSON.parse(await readFile(rosterPath, 'utf8'))
assert(inventory.roomId === roomId && inventory.count === 9 && inventory.roster?.length === 9, 'Expected fixed 9-agent roster')
assert(inventory.roster.every(item => item.ownerMemberId === `auth:${expectedUserId}`), 'Room owner mismatch')
const listed = (await request('/api/hermes/profiles')).profiles
assert(Array.isArray(listed), 'Profiles list missing')
const listedNames = new Set(listed.map(p => p.name))
assert(profileNames.every(n => listedNames.has(n)), 'Native profile roster changed; re-authorize mapping')
assert(listedNames.size === profileNames.length, 'Unexpected new profile: re-authorize asset mapping')
const room = (await request(agentsPath)).agents
assert(Array.isArray(room) && room.length === inventory.count, 'Room roster changed')
for (const target of inventory.roster) {
  const current = room.find(item => item.id === target.id && item.agentId === target.agentId)
  assert(current?.profile === target.profile && current.ownerMemberId === target.ownerMemberId, `Room agent mismatch ${target.profile}`)
  assert(idFor(target.profile), `Unmapped room profile ${target.profile}`)
}
const account = await request(avatarPath)
const member = await request(memberPath)
const memberSnapshots = (await request(snapshotsPath)).snapshots
assert(Array.isArray(memberSnapshots) && memberSnapshots.length <= 256 &&
  memberSnapshots.every(row => typeof row.id === 'string' && typeof row.userId === 'string' && typeof row.avatar === 'string'), 'Invalid room member snapshots')
const oldProfiles = []
for (const name of profileNames) {
  const value = listed.find(p => p.name === name)?.avatar ?? null
  const old = value?.type === 'image' && value.url
    ? await (async () => {
      assert(value.url.startsWith(`/api/hermes/profiles/${encodeURIComponent(name)}/avatar/image/`), 'Unexpected image URL')
      const hash = value.url.split('/').at(-1)
      const image = await request(`/api/hermes/profiles/${encodeURIComponent(name)}/avatar/migration-snapshot/${hash}`)
      assert(image.sha256 === hash && typeof image.mime === 'string' && image.dataUrl?.startsWith(`data:${image.mime};base64,`), `Invalid image snapshot ${name}`)
      const bytes = Buffer.from(image.dataUrl.split(',')[1], 'base64')
      assert(sha(bytes) === hash, `Image hash mismatch ${name}`)
      return { ...value, mime: image.mime, dataUrl: image.dataUrl }
    })() : value
  oldProfiles.push({ name, avatar: old })
}
const snapshot = { schema: 'avatar-library-r3-recovery/v2', roomId, userId: me.id, profiles: oldProfiles, account: account.avatar, member, memberSnapshots, roomAgents: inventory.roster.map(item => ({ id: item.id, agentId: item.agentId, profile: item.profile, avatar: room.find(agent => agent.id === item.id).avatar })) }
const approvedCatalog = opts['--r2-catalog'] ? JSON.parse(await readFile(opts['--r2-catalog'], 'utf8')) : null
if (approvedCatalog) assert(approvedCatalog.revision === 2 && approvedCatalog.profiles?.length === originalProfiles.length, 'Approved r2 catalog mismatch')
const parseAvatar = text => { try { return JSON.parse(text || '{}') } catch { return {} } }
const approvedHash = (avatar, profile) => {
  const approved = approvedCatalog?.profiles.find(p => p.profile === profile)
  if (!approved || avatar.type !== 'image' || typeof avatar.dataUrl !== 'string') return false
  const hash = sha(Buffer.from(avatar.dataUrl.split(',')[1] || '', 'base64'))
  return hash === approved.sha256 || hash === approved.studio_sha256
}
function snapshotTarget(row) {
  if (row.id === member.id && row.authUserId === me.id && row.avatar === member.avatar) return accountAssetId
  if (row.authUserId != null) return null // Never reassign another account's avatar.
  const agent = inventory.roster.find(item => item.agentId === row.userId)
  if (!agent || !idFor(agent.profile)) return null
  const avatar = parseAvatar(row.avatar)
  if (avatar.type === 'library' && avatar.assetId === idFor(agent.profile) && avatar.revision === revision) return idFor(agent.profile)
  return approvedHash(avatar, agent.profile) ? idFor(agent.profile) : null
}
const unresolved = memberSnapshots.filter(row => row.avatar && !snapshotTarget(row)).length
const summary = { mode, roomId, userId: me.id, revision, profiles: oldProfiles.length, roomAgents: room.length, memberSnapshots: memberSnapshots.length, unresolved, oldAvatarBytes: Buffer.byteLength(JSON.stringify(snapshot)), alreadyLibrary: oldProfiles.filter(p => p.avatar?.type === 'library' && p.avatar.assetId === idFor(p.name) && p.avatar.revision === revision).length }
if (mode === 'plan') { console.log(JSON.stringify(summary)); process.exit(0) }
await mkdir(recoveryDir, { recursive: true, mode: 0o700 })
const backup = join(recoveryDir, `avatar-library-r3-user-${expectedUserId}.json`)
let saved
if (mode === 'apply') {
  const alreadyApplied = oldProfiles.every(p => p.avatar?.type === 'library' && p.avatar.assetId === idFor(p.name) && p.avatar.revision === revision)
    && parseAvatar(account.avatar).assetId === accountAssetId
    && snapshot.roomAgents.every(item => item.avatar === roomRef(idFor(item.profile)))
    && member.avatar === roomRef(accountAssetId) && memberSnapshots.every(row => !snapshotTarget(row) || row.avatar === roomRef(snapshotTarget(row)))
  if (alreadyApplied) { console.log(JSON.stringify({ ...summary, alreadyApplied: true })); process.exit(0) }
  assert(approvedCatalog, 'Approved r2 catalog required')
  const accountImage = parseAvatar(account.avatar)
  assert(accountImage.type === 'image' && typeof accountImage.dataUrl === 'string', 'Account avatar is not the approved prior illustration')
  assert(sha(Buffer.from(accountImage.dataUrl.split(',')[1], 'base64')) === opts['--account-avatar-sha256'], 'Current account image hash changed')
  assert(member.avatar === account.avatar, 'Room member avatar snapshot differs from approved current account; refuse automatic replacement')
  for (const entry of oldProfiles) {
    const current = entry.avatar
    if (current?.type === 'library' && current.assetId === idFor(entry.name) && current.revision === revision) continue
    if (current?.type === 'image') {
      const approved = approvedCatalog.profiles.find(p => p.profile === entry.name)
      const hash = sha(Buffer.from(current.dataUrl.split(',')[1], 'base64'))
      assert(entry.name === 'codex-proxy' ? hash === opts['--codex-proxy-avatar-sha256'] :
        approved && (hash === approved.sha256 || hash === approved.studio_sha256), `Refusing custom/unknown upload: ${entry.name}`)
    } else assert(false, `Refusing non-approved image: ${entry.name}`)
  }
  for (const entry of snapshot.roomAgents) {
    const avatar = JSON.parse(entry.avatar || '{}')
    const approved = approvedCatalog.profiles.find(p => p.profile === entry.profile)
    assert(avatar.type === 'image' && typeof avatar.dataUrl === 'string' && approved, `Room avatar is not the approved r2 illustration: ${entry.profile}`)
    const hash = sha(Buffer.from(avatar.dataUrl.split(',')[1], 'base64'))
    assert(hash === approved.sha256 || hash === approved.studio_sha256, `Refusing custom room avatar: ${entry.profile}`)
  }
  // Exclusive creation: never overwrite an existing recovery snapshot; rerun plan or rollback instead.
  const handle = await open(backup, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(snapshot)); await handle.sync() } finally { await handle.close() }
  const dirHandle = await open(recoveryDir, 'r')
  try { await dirHandle.sync() } finally { await dirHandle.close() }
  for (const entry of oldProfiles) await request(profilePath(entry.name), 'PUT', {
    ...ref(idFor(entry.name)),
    ...(entry.avatar?.type === 'image' ? { previousImageHash: entry.avatar.url.split('/').at(-1) } : {}),
  })
  await request(avatarPath, 'PUT', { avatar: roomRef(accountAssetId) })
  await request(memberPath, 'PUT', { avatar: roomRef(accountAssetId), previousAvatar: member.avatar })
  for (const row of memberSnapshots) {
    const target = snapshotTarget(row)
    if (!target || row.id === member.id || row.avatar === roomRef(target)) continue
    const updated = (await request(`${snapshotsPath}/${encodeURIComponent(row.id)}`, 'PUT', { avatar: roomRef(target), previousAvatar: row.avatar })).snapshot
    assert(updated?.id === row.id && updated.avatar === roomRef(target), 'Snapshot write readback mismatch')
  }
  for (const entry of snapshot.roomAgents) {
    const updated = (await request(agentPath(entry.agentId), 'PUT', { avatar: roomRef(idFor(entry.profile)), previousAvatar: entry.avatar })).agent
    assert(updated?.id === entry.id && updated.avatar === roomRef(idFor(entry.profile)), 'Agent write readback mismatch')
  }
} else {
  saved = JSON.parse(await readFile(backup, 'utf8'))
  assert(saved.schema === snapshot.schema && saved.roomId === roomId && saved.userId === expectedUserId, 'Recovery identity mismatch')
  // Fail closed before *any* restoration if a human changed an avatar after migration.
  for (const entry of saved.profiles) {
    const current = listed.find(p => p.name === entry.name)?.avatar ?? null
    const expected = ref(idFor(entry.name))
    const unchanged = JSON.stringify(current) === JSON.stringify(entry.avatar)
      || (current?.type === 'image' && entry.avatar?.type === 'image' && current.url === entry.avatar.url)
    assert(unchanged || (current?.type === 'library' && current.assetId === expected.assetId && current.revision === expected.revision), `Profile drift: ${entry.name}`)
  }
  const accountCurrent = JSON.parse(account.avatar || '{}')
  assert(account.avatar === saved.account || (accountCurrent.type === 'library' && accountCurrent.assetId === accountAssetId && accountCurrent.revision === revision), 'Account avatar drift')
  assert(member.id === saved.member?.id && (member.avatar === saved.member.avatar || member.avatar === roomRef(accountAssetId)), 'Member avatar drift')
  for (const entry of saved.roomAgents) {
    const current = snapshot.roomAgents.find(item => item.id === entry.id && item.agentId === entry.agentId)
    assert(current && (current.avatar === entry.avatar || current.avatar === roomRef(idFor(entry.profile))), `Agent avatar drift: ${entry.profile}`)
  }
  assert(Array.isArray(saved.memberSnapshots) && saved.memberSnapshots.length === memberSnapshots.length &&
    saved.memberSnapshots.every(row => {
      const current = memberSnapshots.find(item => item.id === row.id && item.userId === row.userId && item.authUserId === row.authUserId)
      const target = snapshotTarget(row)
      return current && (current.avatar === row.avatar ||
        (row.id === saved.member.id && current.avatar === roomRef(accountAssetId)) ||
        (target && current.avatar === roomRef(target)))
    }), 'Historical snapshot drift; refuse entire rollback')
  for (const entry of saved.profiles) {
    if (!profileNames.includes(entry.name)) throw new Error('Recovery contains unexpected profile')
    if (!entry.avatar) await request(profilePath(entry.name), 'DELETE')
    else if (entry.avatar.type === 'image') await request(profilePath(entry.name), 'PUT', { type: 'image', dataUrl: entry.avatar.dataUrl })
    else await request(profilePath(entry.name), 'PUT', entry.avatar)
  }
  await request(avatarPath, 'PUT', { avatar: saved.account || JSON.stringify({ type: 'default' }) })
  assert(saved.member?.id === member.id, 'Recovery member identity mismatch')
  await request(memberPath, 'PUT', { avatar: saved.member.avatar, previousAvatar: member.avatar })
  for (const row of saved.memberSnapshots) {
    const current = memberSnapshots.find(item => item.id === row.id)
    if (current.avatar === row.avatar || row.id === saved.member.id) continue
    const updated = (await request(`${snapshotsPath}/${encodeURIComponent(row.id)}`, 'PUT', { avatar: row.avatar, previousAvatar: current.avatar })).snapshot
    assert(updated?.id === row.id && updated.avatar === row.avatar, 'Snapshot rollback readback mismatch')
  }
  for (const entry of saved.roomAgents) {
    assert(inventory.roster.some(item => item.agentId === entry.agentId && item.id === entry.id), 'Recovery agent mismatch')
    const current = snapshot.roomAgents.find(item => item.id === entry.id)
    const updated = (await request(agentPath(entry.agentId), 'PUT', { avatar: entry.avatar, previousAvatar: current.avatar })).agent
    assert(updated?.id === entry.id && updated.avatar === entry.avatar, 'Agent rollback readback mismatch')
  }
}
const after = (await request(agentsPath)).agents
assert(after.length === inventory.roster.length, 'Room agent readback count changed')
for (const target of inventory.roster) {
  const agent = after.find(item => item.agentId === target.agentId)
  assert(agent?.avatar === (mode === 'apply' ? roomRef(idFor(target.profile)) : saved.roomAgents.find(item => item.agentId === target.agentId)?.avatar), `Room avatar readback mismatch ${target.profile}`)
}
const profileReadback = (await request('/api/hermes/profiles')).profiles
for (const target of oldProfiles) {
  const avatar = profileReadback.find(p => p.name === target.name)?.avatar
  const original = saved?.profiles.find(p => p.name === target.name)?.avatar
  const restored = !original ? !avatar
    : original.type === 'image' ? avatar?.url === original.url
    : original.type === 'generated' ? avatar?.type === 'generated' && avatar?.seed === original.seed
    : original.type === 'library' ? avatar?.assetId === original.assetId && avatar?.revision === original.revision
    : false
  assert(mode === 'apply' ? avatar?.assetId === idFor(target.name) && avatar?.revision === revision : restored, `Profile readback mismatch ${target.name}`)
}
const accountReadback = (await request(avatarPath)).avatar
assert(mode === 'apply' ? JSON.parse(accountReadback).assetId === accountAssetId : accountReadback === (saved.account || JSON.stringify({ type: 'default' })), 'Account readback mismatch')
const memberReadback = await request(memberPath)
assert(memberReadback.id === member.id && memberReadback.avatar === (mode === 'apply' ? roomRef(accountAssetId) : saved.member.avatar), 'Room member readback mismatch')
const snapshotsReadback = (await request(snapshotsPath)).snapshots
assert(snapshotsReadback.length === memberSnapshots.length && memberSnapshots.every(row => {
  const current = snapshotsReadback.find(item => item.id === row.id && item.userId === row.userId && item.authUserId === row.authUserId)
  const expected = mode === 'apply' && snapshotTarget(row) ? roomRef(snapshotTarget(row)) :
    mode === 'rollback' ? saved.memberSnapshots.find(item => item.id === row.id)?.avatar : row.avatar
  return current && current.avatar === expected
}), 'Historical snapshot readback mismatch')
console.log(JSON.stringify({ ...summary, recovery: backup, verifiedRoomAgents: after.length }))
reader.close()
