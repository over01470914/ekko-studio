import { join } from 'node:path'
import { PersonalReceiver, PersonalClient, PersonalError, readPrivateConfig, parseRequest, type ReceiverConfig, type ClientConfig } from '../../../../../../personal-assistant/src'

export class PersonalAgentService {
  private readonly clients: { config: ClientConfig; client: PersonalClient }[]
  constructor(private readonly receiver: PersonalReceiver | null, peers: readonly ClientConfig[]) {
    if (peers.length > 16) throw new PersonalError('INVALID_CONFIGURATION')
    this.clients = peers.map(config => ({ config: Object.freeze({ ...config }), client: new PersonalClient(config) }))
    const identities = this.clients.map(({ config }) => `${config.ownerId}/${config.deviceId}/${config.workspaceId}`)
    if (new Set(identities).size !== identities.length) throw new PersonalError('INVALID_CONFIGURATION')
  }
  close() { this.receiver?.close() }
  async stateFor(ownerId: string) {
    const local = this.receiver?.stateFor(ownerId)
    const workspaces = [...(local?.workspaces || [])]
    const peers = await Promise.all(this.clients.filter(item => item.config.ownerId === ownerId && item.config.deviceId !== this.receiver?.deviceId).map(async ({ config, client }) => {
      try {
        const state = await client.stateFor(ownerId)
        workspaces.push(...state.workspaces.map(workspace => ({ ...workspace,
          capabilities: workspace.capabilities.filter((capability): capability is 'search' | 'read' | 'write' | 'delete' =>
            ['search', 'read', 'write', 'delete'].includes(capability)) })))
        return { deviceId: config.deviceId, workspaceId: config.workspaceId, available: true }
      } catch (error) { return { deviceId: config.deviceId, workspaceId: config.workspaceId, available: false,
        error: error instanceof PersonalError ? error.code : 'UNAVAILABLE' } }
    }))
    workspaces.sort((a, b) => `${a.deviceId}/${a.id}`.localeCompare(`${b.deviceId}/${b.id}`, 'en'))
    return { version: 1, configured: true, workspaces, peers, grants: local?.grants || [] }
  }
  async execute(ownerId: string, input: unknown) {
    const request = parseRequest(input)
    const target = this.clients.find(item => item.config.ownerId === ownerId && item.config.deviceId === request.deviceId && item.config.workspaceId === request.workspaceId)
    if (!target) throw new PersonalError('FORBIDDEN', 403)
    if (this.receiver?.deviceId === request.deviceId) {
      const peer = this.receiver.authenticate(target.config.credential, target.config.sourceOrigin)
      if (peer.ownerId !== ownerId) throw new PersonalError('FORBIDDEN', 403)
      return this.receiver.execute(peer, request)
    }
    return target.client.execute(ownerId, request)
  }
  setGrant(ownerId: string, id: string, expectedRevision: number, capabilities: ('search' | 'read' | 'write' | 'delete')[]) {
    if (!this.receiver) throw new PersonalError('UNAVAILABLE', 503)
    return this.receiver.setGrant(ownerId, id, expectedRevision, capabilities)
  }
  confirmDelete(ownerId: string, sourceDeviceId: string, request: unknown) {
    if (!this.receiver) throw new PersonalError('UNAVAILABLE', 503)
    // Only this receiver's owner confirms deletion. The sender/MCP cannot mint a remote owner's confirmation.
    return this.receiver.confirmDelete(ownerId, sourceDeviceId, request)
  }
  restore(ownerId: string, receiptId: string) {
    if (!this.receiver) throw new PersonalError('UNAVAILABLE', 503)
    return this.receiver.restore(ownerId, receiptId)
  }
}
export function loadPersonalAgentService(dataRoot: string): PersonalAgentService | null {
  let config: Record<string, unknown>
  try { config = readPrivateConfig(join(dataRoot, 'pilot.json')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  if (config.version !== 1 || !Array.isArray(config.peers)) throw new PersonalError('INVALID_CONFIGURATION')
  let receiver: PersonalReceiver | null = null
  try {
    if (config.receiver) receiver = new PersonalReceiver({ ...(config.receiver as ReceiverConfig), stateRoot: join(dataRoot, 'receiver') })
    return new PersonalAgentService(receiver, config.peers as ClientConfig[])
  } catch (error) { receiver?.close(); throw error }
}
