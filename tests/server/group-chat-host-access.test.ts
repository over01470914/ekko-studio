import { describe, expect, it } from 'vitest'
import { createTestGroupChatServer } from './group-chat-test-helpers'
import { GC_ROOM_AGENTS_SCHEMA } from '../../packages/server/src/modules/studio/infrastructure/database/schemas'
import { buildNonOwnerRequestSecurityPrompt } from '../../packages/server/src/modules/studio/services/group-chat/agent-prompt'
import { canGrantGroupAgentHostAccess } from '../../packages/server/src/modules/studio/services/group-chat/host-access'
import { canConfigureGroupAgentHostAccess } from '../../packages/server/src/modules/studio/services/group-chat/access'
import { setGroupChatServer, updateRoomAgentHostAccess } from '../../packages/server/src/modules/studio/controllers/group-chat'
import { afterEach, vi } from 'vitest'

const owner = 'auth:42'
const local = (id: string, hostAccessEnabled = 0) => ({ id, agentId: id, executorType: 'server', ownerMemberId: owner, hostAccessEnabled })
const room = { id: 'room', ownerAuthUserId: 42 }

function storage(sender: any, target: any, message: any) {
  return {
    getRoom: () => room,
    getRoomAgentByAgentId: (_roomId: string, id: string) => id === sender?.agentId ? sender : id === target?.agentId ? target : null,
    getMessage: () => message,
  }
}

const agentMessage = { roomId: 'room', senderId: 'source', senderAgentRecordId: 'source', senderType: 'agent', role: 'assistant' }

describe('per-room-agent host access', () => {
  afterEach(() => setGroupChatServer(null as any))

  it('requires a positive authenticated owner and rejects profile managers and super admins of another room', () => {
    const roomStorage = { getRoom: () => room, getRoomsForProfiles: () => [room] }
    expect(canConfigureGroupAgentHostAccess(roomStorage as any, 'room', { id: 42, role: 'user', status: 'active' })).toBe(true)
    expect(canConfigureGroupAgentHostAccess(roomStorage as any, 'room', { id: 42, status: 'disabled' })).toBe(false)
    expect(canConfigureGroupAgentHostAccess(roomStorage as any, 'room', { id: 17, role: 'super_admin' })).toBe(false)
    expect(canConfigureGroupAgentHostAccess(roomStorage as any, 'room', { profiles: ['owner'] })).toBe(false)
    expect(canConfigureGroupAgentHostAccess({ getRoom: () => ({ ownerAuthUserId: 0 }) } as any, 'room', { id: 42 })).toBe(false)
  })

  it('saves the boolean flag for the owner without replacing the runtime and rejects managed credentials', async () => {
    const target = local('target')
    const setRoomAgentHostAccess = vi.fn((_room: string, _agent: string, enabled: boolean) => {
      const updated = { ...target, hostAccessEnabled: enabled ? 1 : 0 }
      storedTarget = updated
      return updated
    })
    let storedTarget = target
    const replace = vi.fn()
    const interrupt = vi.fn(async () => true)
    setGroupChatServer({
      getStorage: () => ({ getRoom: () => room, getRoomAgent: () => storedTarget, setRoomAgentHostAccess }),
      agentClients: { removeAgentFromRoom: replace, getAgent: () => ({ interrupt }) },
      broadcastRoomAgents: () => [storedTarget],
    } as any)
    const request = (user: any, flag: unknown, runCredential = false) => ({
      params: { roomId: 'room', agentId: 'target' }, state: { user, runCredential },
      request: { body: { hostAccessEnabled: flag } },
    } as any)
    const guest = request({ id: 17, role: 'super_admin' }, true)
    await updateRoomAgentHostAccess(guest)
    expect(guest.status).toBe(403)
    const managed = request({ id: 42 }, true, true)
    await updateRoomAgentHostAccess(managed)
    expect(managed.status).toBe(403)
    const invalid = request({ id: 42, status: 'active' }, 'true')
    await updateRoomAgentHostAccess(invalid)
    expect(invalid.status).toBe(400)
    const owner = request({ id: 42, status: 'active' }, true)
    await updateRoomAgentHostAccess(owner)
    expect(owner.body.agent.hostAccessEnabled).toBe(1)
    expect(setRoomAgentHostAccess).toHaveBeenCalledOnce()
    expect(replace).not.toHaveBeenCalled()
    expect(interrupt).not.toHaveBeenCalled()
    const revoke = request({ id: 42, status: 'active' }, false)
    await updateRoomAgentHostAccess(revoke)
    expect(revoke.body.agent.hostAccessEnabled).toBe(0)
    expect(interrupt).toHaveBeenCalledExactlyOnceWith('room')
  })
  it('persists revocation even if targeted interruption cannot be confirmed', async () => {
    let target = local('target', 1)
    const setRoomAgentHostAccess = vi.fn((_room: string, _agent: string, enabled: boolean) => (target = { ...target, hostAccessEnabled: Number(enabled) }))
    const interrupt = vi.fn(async () => false)
    const broadcastRoomAgents = vi.fn(() => [target])
    setGroupChatServer({
      getStorage: () => ({ getRoom: () => room, getRoomAgent: () => target, setRoomAgentHostAccess }),
      agentClients: { getAgent: () => ({ interrupt }) },
      broadcastRoomAgents,
    } as any)
    const ctx = { params: { roomId: 'room', agentId: 'target' }, state: { user: { id: 42, status: 'active' } }, request: { body: { hostAccessEnabled: false } } } as any
    await updateRoomAgentHostAccess(ctx)
    expect(ctx.status).toBe(503)
    expect(setRoomAgentHostAccess).toHaveBeenCalledExactlyOnceWith('room', 'target', false, owner)
    expect(interrupt).toHaveBeenCalledExactlyOnceWith('room')
    expect(broadcastRoomAgents).toHaveBeenCalledOnce()
    const retry = { ...ctx, request: { body: { hostAccessEnabled: false } } }
    await updateRoomAgentHostAccess(retry)
    expect(retry.status).toBe(503)
    expect(interrupt).toHaveBeenCalledTimes(2)
    expect(broadcastRoomAgents).toHaveBeenCalledTimes(2)
  })
  it('does not allow a simultaneous enable to overtake a pending revocation', async () => {
    const target = local('target', 1)
    let resolveInterrupt!: (value: boolean) => void
    const interrupt = vi.fn(() => new Promise<boolean>(resolve => { resolveInterrupt = resolve }))
    const setRoomAgentHostAccess = vi.fn((_room: string, _agent: string, enabled: boolean) => ({ ...target, hostAccessEnabled: Number(enabled) }))
    setGroupChatServer({
      getStorage: () => ({ getRoom: () => room, getRoomAgent: () => target, setRoomAgentHostAccess }),
      agentClients: { getAgent: () => ({ interrupt }) },
      broadcastRoomAgents: () => [],
    } as any)
    const request = (hostAccessEnabled: boolean) => ({ params: { roomId: 'room', agentId: 'target' }, state: { user: { id: 42, status: 'active' } }, request: { body: { hostAccessEnabled } } } as any)
    const off = request(false)
    const revoke = updateRoomAgentHostAccess(off)
    const on = request(true)
    await updateRoomAgentHostAccess(on)
    expect(on.status).toBe(409)
    expect(setRoomAgentHostAccess).toHaveBeenCalledOnce()
    resolveInterrupt(true)
    await revoke
    expect(off.body.agent.hostAccessEnabled).toBe(0)
  })

  it('rejects explicitly foreign, remote, and ownerless legacy targets at the endpoint', async () => {
    let target: any = { ...local('target'), ownerMemberId: 'auth:17' }
    const setRoomAgentHostAccess = vi.fn()
    let currentRoom: any = room
    setGroupChatServer({ getStorage: () => ({ getRoom: () => currentRoom, getRoomAgent: () => target, setRoomAgentHostAccess }) } as any)
    const request = () => ({ params: { roomId: 'room', agentId: 'target' }, state: { user: { id: 42, status: 'active' } }, request: { body: { hostAccessEnabled: true } } } as any)
    for (const invalid of [{ ...target }, { ...target, ownerMemberId: '', executorType: 'remote' }, { ...target, ownerMemberId: '', connectorId: 'remote-link' }]) {
      target = invalid
      const ctx = request()
      await updateRoomAgentHostAccess(ctx)
      expect(ctx.status).toBe(409)
    }
    target = { ...local('target'), ownerMemberId: '' }
    currentRoom = { ...room, ownerAuthUserId: 0 }
    const ctx = request()
    await updateRoomAgentHostAccess(ctx)
    expect(ctx.status).toBe(403)
    expect(setRoomAgentHostAccess).not.toHaveBeenCalled()
  })

  it('defaults to disabled in existing and new SQLite rows', () => {
    expect(GC_ROOM_AGENTS_SCHEMA.hostAccessEnabled).toBe('INTEGER NOT NULL DEFAULT 0')
  })

  it('configures a stored legacy local target without recreating it and validates its legacy sender', async () => {
    const harness = await createTestGroupChatServer()
    try {
      const db = harness.groupServer.getStorage()
      db.saveRoom('legacy', 'Legacy', 'LEGACY', { ownerAuthUserId: 42 })
      expect(db.getRoomAgents('legacy')).toEqual([])
      const target = db.addRoomAgent('legacy', 'target', 'default', 'Target', '', 1)
      const sender = db.addRoomAgent('legacy', 'source', 'default', 'Source', '', 1)
      expect(db.getRoomAgent('legacy', target.id)?.hostAccessEnabled).toBe(0)
      expect(target.ownerMemberId).toBe('')
      db.setRoomAgentHostAccess('legacy', target.id, true, owner)
      const updated = db.getRoomAgentByAgentId('legacy', 'target')!
      expect(updated).toMatchObject({ id: target.id, hostAccessEnabled: 1, ownerMemberId: owner })
      const message = { ...agentMessage, roomId: 'legacy', senderAgentRecordId: sender.id }
      expect(canGrantGroupAgentHostAccess({
        getRoom: () => db.getRoom('legacy'),
        getRoomAgentByAgentId: (roomId: string, id: string) => db.getRoomAgentByAgentId(roomId, id),
        getMessage: () => message,
      } as any, 'legacy', 'target', 'source', 'message')).toBe(true)
      expect(db.setRoomAgentHostAccess('legacy', target.id, false, owner)?.hostAccessEnabled).toBe(0)
      expect(db.getRoomAgent('legacy', target.id)?.hostAccessEnabled).toBe(0)
    } finally {
      harness.cleanup()
    }
  })

  it('permits only a persisted same-owner local Agent handoff to an enabled local target', () => {
    const target = local('target', 1)
    expect(canGrantGroupAgentHostAccess(storage(local('source'), target, agentMessage) as any, 'room', 'target', 'source', 'message')).toBe(true)
    expect(canGrantGroupAgentHostAccess({ ...storage(local('source'), target, agentMessage), getRoom: () => ({ ownerAuthUserId: '42' }) } as any, 'room', 'target', 'source', 'message')).toBe(false)
    target.hostAccessEnabled = 0
    expect(canGrantGroupAgentHostAccess(storage(local('source'), target, agentMessage) as any, 'room', 'target', 'source', 'message')).toBe(false)
  })

  it('rejects guest, remote, removed, spoofed, and different-owner senders', () => {
    const target = local('target', 1)
    const check = (sender: any, message: any = agentMessage) => canGrantGroupAgentHostAccess(storage(sender, target, message) as any, 'room', 'target', 'source', 'message')
    expect(check(null)).toBe(false)
    expect(check({ ...local('source'), executorType: 'remote' })).toBe(false)
    expect(check({ ...local('source'), ownerMemberId: 'auth:17' })).toBe(false)
    expect(check({ ...local('source'), ownerMemberId: '', connectorId: 'remote-link' })).toBe(false)
    expect(check(local('source'), { ...agentMessage, senderAgentRecordId: 'other' })).toBe(false)
    expect(check(local('source'), { ...agentMessage, senderId: 'other' })).toBe(false)
    expect(check(local('source'), { ...agentMessage, senderType: 'member' })).toBe(false)
    expect(check(local('source'), { ...agentMessage, roomId: 'other' })).toBe(false)
    expect(canGrantGroupAgentHostAccess(storage(local('source'), { ...target, executorType: 'remote' }, agentMessage) as any, 'room', 'target', 'source', 'message')).toBe(false)
    expect(canGrantGroupAgentHostAccess(storage(local('source'), { ...target, ownerMemberId: 'auth:17' }, agentMessage) as any, 'room', 'target', 'source', 'message')).toBe(false)
    expect(canGrantGroupAgentHostAccess(storage({ ...local('source'), ownerMemberId: '' }, { ...target, ownerMemberId: '' }, agentMessage) as any, 'room', 'target', 'source', 'message')).toBe(true)
    expect(canGrantGroupAgentHostAccess({ ...storage({ ...local('source'), ownerMemberId: '' }, target, agentMessage), getRoom: () => ({ ownerAuthUserId: 0 }) } as any, 'room', 'target', 'source', 'message')).toBe(false)
  })

  it('re-reads persisted target and sender after queueing and revocation, failing closed on removal', () => {
    const sender = local('source')
    let target: ReturnType<typeof local> | null = local('target', 1)
    const persisted = storage(sender, target, agentMessage)
    const read = () => canGrantGroupAgentHostAccess({
      ...persisted,
      getRoomAgentByAgentId: (_roomId: string, id: string) => id === 'source' ? sender : target,
    } as any, 'room', 'target', 'source', 'message')
    expect(read()).toBe(true)
    target.hostAccessEnabled = 0
    expect(read()).toBe(false)
    target = null
    expect(read()).toBe(false)
  })

  it('relaxes only the workspace rule and retains credential, privacy, and memory rules', () => {
    const prompt = buildNonOwnerRequestSecurityPrompt({ requesterName: 'Worker', requesterId: 'source', ownerMemberId: owner, workspaceRoot: '/room', hostAccessEnabled: true })
    expect(prompt).toContain('outside the group workspace')
    expect(prompt).not.toContain('Only read, list, search, create, modify, delete, or copy content whose resolved path is inside that workspace')
    expect(prompt).toContain('Do not search for credentials')
    expect(prompt).toContain('Do not expose sensitive information')
    expect(prompt).toContain('Protect private memory')
  })
})
