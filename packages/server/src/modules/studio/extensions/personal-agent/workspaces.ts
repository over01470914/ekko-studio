import { mkdirSync, readdirSync, writeFileSync, renameSync, realpathSync, existsSync } from 'node:fs'
import { basename, join, sep } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { PersonalReceiver, PersonalError, readPrivateConfig, parseRequest, type Capability, type ReceiverConfig, type ClientConfig } from '../../../../../../personal-assistant/src'
import { PersonalAgentService } from './service'

type Installation = { receiver: ReceiverConfig; peers: ClientConfig[] }
export type PersonalFileService = Pick<PersonalAgentService, 'close' | 'stateFor' | 'execute' | 'setGrant' | 'confirmDelete' | 'restore'>

// Native main passes a folder selected by the owner. HTTP and the renderer cannot supply a root.
export class PersonalWorkspaceService implements PersonalFileService {
  private readonly records = new Map<string, { installation: Installation; service: PersonalAgentService }>()
  private readonly receipts: Record<string, string> = Object.create(null)
  readonly deviceId: string
  constructor(private readonly dataRoot: string, private readonly ownerId: string, private readonly origin: string, private readonly hostname: string) {
    mkdirSync(dataRoot, { recursive: true, mode: 0o700 })
    const identityFile = join(dataRoot, 'identity.json')
    if (!existsSync(identityFile)) writeFileSync(identityFile, JSON.stringify({ version: 1, deviceId: randomUUID() }), { mode: 0o600, flag: 'wx' })
    const identity = readPrivateConfig(identityFile)
    if (identity.version !== 1 || typeof identity.deviceId !== 'string') throw new PersonalError('INVALID_CONFIGURATION')
    this.deviceId = identity.deviceId
    for (const file of readdirSync(dataRoot).filter(file => /^[a-f0-9-]{36}\.json$/.test(file))) {
      const installation = readPrivateConfig(join(dataRoot, file)) as unknown as Installation
      const receiver = new PersonalReceiver(installation.receiver)
      try { this.records.set(file.slice(0, -5), { installation, service: new PersonalAgentService(receiver, installation.peers) }) }
      catch (error) { receiver.close(); this.close(); throw error }
    }
    const receiptsFile = join(dataRoot, 'receipts.json')
    if (existsSync(receiptsFile)) Object.assign(this.receipts, readPrivateConfig(receiptsFile))
  }
  async onboard(root: string, label: string, capabilities: Capability[]) {
    if (this.records.size >= 8 || !label.trim() || label.length > 128) throw new PersonalError('INVALID_CONFIGURATION')
    const canonical = realpathSync(root)
    const state = realpathSync(this.dataRoot)
    const overlaps = (a: string, b: string) => a === b || a.startsWith(b + sep) || b.startsWith(a + sep)
    if (overlaps(canonical, state) || [...this.records.values()].some(item => item.installation.receiver.workspaces.some(workspace => overlaps(canonical, workspace.root)))) throw new PersonalError('WORKSPACE_OVERLAP', 409)
    const id = randomUUID(); const credential = randomBytes(32).toString('hex')
    const config: ReceiverConfig = { deviceId: this.deviceId, hostname: this.hostname, stateRoot: join(this.dataRoot, id),
      workspaces: [{ id, root: canonical, label: label.trim() || basename(canonical), ownerId: this.ownerId }],
      approvals: [{ id: randomUUID(), ownerId: this.ownerId, sourceDeviceId: this.deviceId, sourceOrigin: this.origin, workspaceId: id, token: credential, capabilities }] }
    const installation: Installation = { receiver: config, peers: [{ origin: this.origin, deviceId: this.deviceId, workspaceId: id,
      ownerId: this.ownerId, sourceDeviceId: this.deviceId, sourceOrigin: this.origin, credential }] }
    const receiver = new PersonalReceiver(config)
    try {
      const service = new PersonalAgentService(receiver, installation.peers)
      writeFileSync(join(this.dataRoot, `${id}.json`), JSON.stringify(installation), { mode: 0o600, flag: 'wx' })
      this.records.set(id, { installation, service })
      return (await service.stateFor(this.ownerId)).workspaces[0]
    } catch (error) { receiver.close(); throw error }
  }
  async stateFor(ownerId: string) {
    if (ownerId !== this.ownerId) return { version: 1, configured: false, workspaces: [], peers: [], grants: [] }
    const states = await Promise.all([...this.records.values()].map(item => item.service.stateFor(ownerId)))
    return { version: 1, configured: states.length > 0, workspaces: states.flatMap(state => state.workspaces), peers: states.flatMap(state => state.peers), grants: states.flatMap(state => state.grants) }
  }
  private target(ownerId: string, workspaceId: string) {
    if (ownerId !== this.ownerId) throw new PersonalError('FORBIDDEN', 403)
    const record = this.records.get(workspaceId)
    if (!record) throw new PersonalError('FORBIDDEN', 403)
    return record.service
  }
  async execute(ownerId: string, value: unknown) {
    const request = parseRequest(value)
    const result = await this.target(ownerId, request.workspaceId).execute(ownerId, request)
    if (result.action === 'delete' && result.outcome === 'completed' && 'receiptId' in result.data) {
      this.receipts[result.data.receiptId] = request.workspaceId
      try {
        const temp = join(this.dataRoot, `receipts-${randomUUID()}.tmp`)
        writeFileSync(temp, JSON.stringify(this.receipts), { mode: 0o600, flag: 'wx' }); renameSync(temp, join(this.dataRoot, 'receipts.json'))
      } catch { return { ...result, outcome: 'unknown' as const, data: { state: 'unknown' as const } } }
    }
    return result
  }
  setGrant(ownerId: string, id: string, revision: number, capabilities: Capability[]) {
    const record = [...this.records.values()].find(item => item.installation.receiver.approvals.some(approval => approval.id === id))
    if (!record || ownerId !== this.ownerId) throw new PersonalError('FORBIDDEN', 403)
    return record.service.setGrant(ownerId, id, revision, capabilities)
  }
  confirmDelete(ownerId: string, sourceDeviceId: string, value: unknown) {
    const workspaceId = (value as { workspaceId?: unknown })?.workspaceId
    if (typeof workspaceId !== 'string') throw new PersonalError('INVALID_REQUEST')
    return this.target(ownerId, workspaceId).confirmDelete(ownerId, sourceDeviceId, value)
  }
  restore(ownerId: string, receiptId: string) {
    return this.target(ownerId, this.receipts[receiptId]).restore(ownerId, receiptId)
  }
  close() { for (const record of this.records.values()) record.service.close(); this.records.clear() }
}
