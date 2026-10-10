import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestGroupChatServer } from './group-chat-test-helpers'
import { AgentClient } from '../../packages/server/src/modules/studio/services/group-chat/agent-clients'

describe('group Agent room-message acknowledgement lifecycle', () => {
  let harness: Awaited<ReturnType<typeof createTestGroupChatServer>>
  let agent: AgentClient

  beforeEach(async () => {
    harness = await createTestGroupChatServer()
    const storage = harness.groupServer.getStorage()
    storage.saveRoom('room-ack', 'Ack Room', 'INVACK')
    storage.addRoomAgent('room-ack', 'agent-ack', 'default', 'AckWorker', '', 0)
    agent = new AgentClient({
      agentId: 'agent-ack', profile: 'default', name: 'AckWorker', description: '',
      invited: 0, backgroundDelegationEnabled: false,
    })
    await agent.connect(harness.port)
    await harness.groupServer.agentClients.addAgentToRoom('room-ack', agent)
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await agent?.disconnect()
    harness?.cleanup()
  })

  it('resolves the acknowledgement while the transport stays connected', async () => {
    const id = await agent.sendMessage('room-ack', 'hello', 'ack-ok-1')
    expect(id).toBe('ack-ok-1')
  })

  it('rejects a pending room message when the transport is closed before the ACK', async () => {
    const namespace = harness.groupServer.getIO().of('/group-chat')
    const socket = (agent as any).socket
    const serverSocket = namespace.sockets.get(socket.id!)
    const pending = agent.sendMessage('room-ack', 'never-acked', 'ack-drop-1')
    serverSocket!.disconnect(true)
    await expect(pending).rejects.toThrow(/disconnected before the room message was acknowledged/)
  })

  it('times out a missing ACK and removes its disconnect listener', async () => {
    vi.useFakeTimers()
    const socket = (agent as any).socket
    const before = socket.listeners('disconnect').length
    let acknowledge: (response: { id: string }) => void = () => {}
    vi.spyOn(socket, 'emit').mockImplementation((_event: unknown, _payload: unknown, callback: any) => {
      acknowledge = callback
      return socket
    })
    const pending = agent.sendMessage('room-ack', 'no response', 'ack-timeout')
    const rejected = expect(pending).rejects.toThrow('Timed out waiting for room message acknowledgement')
    await vi.advanceTimersByTimeAsync(60_000)
    await rejected
    expect(socket.listeners('disconnect')).toHaveLength(before)
    expect(() => acknowledge({ id: 'late-ack' })).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([undefined, {}, { id: '' }])('rejects malformed acknowledgements: %j', async response => {
    const socket = (agent as any).socket
    const before = socket.listeners('disconnect').length
    vi.spyOn(socket, 'emit').mockImplementation((_event: unknown, _payload: unknown, callback: any) => {
      callback(response)
      return socket
    })
    await expect(agent.sendMessage('room-ack', 'invalid response', 'ack-invalid'))
      .rejects.toThrow('Invalid room message acknowledgement')
    expect(socket.listeners('disconnect')).toHaveLength(before)
  })
})
