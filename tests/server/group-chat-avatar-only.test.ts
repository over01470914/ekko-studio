import { afterEach, describe, expect, it, vi } from 'vitest'
import { roomMemberAvatar, setGroupChatServer, updateRoomAgentAvatar } from '../../packages/server/src/modules/studio/controllers/group-chat'
import { createTestGroupChatServer } from './group-chat-test-helpers'
import { randomUUID } from 'node:crypto'

describe('avatar-only room agent persistence', () => {
  afterEach(() => setGroupChatServer(null as any))
  it('requires owner authorization and never replaces or interrupts the runtime', async () => {
    const prior = { id: 'agent-1', agentId: 'agent-1', avatar: '', profile: 'artist', model: 'm', description: 'unchanged' }
    const room = { id: 'room', ownerAuthUserId: 42 }
    const setRoomAgentAvatar = vi.fn((_room: string, _id: string, avatar: string) => ({ ...prior, avatar }))
    const removeAgentFromRoom = vi.fn()
    const broadcastRoomAgents = vi.fn()
    setGroupChatServer({
      getStorage: () => ({ getRoom: () => room, getRoomAgent: () => prior, getRoomsForProfiles: () => [room], setRoomAgentAvatar }),
      agentClients: { removeAgentFromRoom }, broadcastRoomAgents,
    } as any)
    const value = JSON.stringify({ type: 'library', assetId: 'ip-003', revision: 3 })
    const ctx = (user: any, avatar: string) => ({ params: { roomId: 'room', agentId: 'agent-1' }, state: { user }, request: { body: { avatar } } } as any)
    const denied = ctx({ id: 17, role: 'user' }, value)
    await updateRoomAgentAvatar(denied)
    expect(denied.status).toBe(403)
    const invalid = ctx({ id: 42, role: 'user' }, 'https://attacker.invalid')
    await updateRoomAgentAvatar(invalid)
    expect(invalid.status).toBe(400)
    const owner = ctx({ id: 42, role: 'user' }, value)
    await updateRoomAgentAvatar(owner)
    expect(owner.body.agent).toMatchObject({ profile: 'artist', model: 'm', description: 'unchanged', avatar: value })
    expect(setRoomAgentAvatar).toHaveBeenCalledOnce()
    expect(removeAgentFromRoom).not.toHaveBeenCalled()
    expect(broadcastRoomAgents).toHaveBeenCalledOnce()
  })
  it('updates only gc_room_agents.avatar in persisted storage', async () => {
    const harness = await createTestGroupChatServer()
    try {
      const store = harness.groupServer.getStorage()
      const roomId = randomUUID()
      store.saveRoom(roomId, 'test', 'CODE', { ownerAuthUserId: 42 })
      const agent = store.addRoomAgent(roomId, 'agent-1', 'artist', 'artist', '', 1)
      const original = store.getRoomAgent(roomId, agent.id)!
      const avatar = JSON.stringify({ type: 'library', assetId: 'ip-003', revision: 3 })
      const updated = store.setRoomAgentAvatar(roomId, agent.id, avatar)!
      expect(updated.avatar).toBe(avatar)
      expect({ ...updated, avatar: original.avatar }).toEqual(original)
    } finally { harness.cleanup() }
  })
  it('restricts member snapshots to the authenticated owner and an exact prior value', async () => {
    const room = { id: 'room', ownerAuthUserId: 42 }
    const member = { id: 'member-1', avatar: 'old' }
    const setMemberAvatarByAuthUserId = vi.fn((_room: string, _user: number, _id: string, _old: string, avatar: string) => { member.avatar = avatar; return true })
    setGroupChatServer({ getStorage: () => ({ getRoom: () => room, getRoomsForProfiles: () => [room], getMemberByAuthUserId: () => member, setMemberAvatarByAuthUserId }) } as any)
    const avatar = JSON.stringify({ type: 'library', assetId: 'ip-012', revision: 3 })
    const ctx = (id: number, previousAvatar: string) => ({ method: 'PUT', params: { roomId: 'room' }, state: { user: { id, role: 'user' } }, request: { body: { previousAvatar, avatar } } } as any)
    const denied = ctx(17, 'old')
    await roomMemberAvatar(denied)
    expect(denied.status).toBe(403)
    const stale = ctx(42, 'stale')
    await roomMemberAvatar(stale)
    expect(stale.status).toBe(409)
    const allowed = ctx(42, 'old')
    await roomMemberAvatar(allowed)
    expect(allowed.body).toEqual({ id: 'member-1', avatar })
    expect(setMemberAvatarByAuthUserId).toHaveBeenCalledWith('room', 42, 'member-1', 'old', avatar)
  })
})
