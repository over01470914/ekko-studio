import { mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PersonalError, readPrivateConfig, plainJson, matchesSchema } from '../../../../../../personal-assistant/src'
import schema from './central.schema.json'
import { CentralConnection, centralJson, type CentralConfig } from './central'

export class PersonalCentralStore {
  private readonly connections = new Map<string, CentralConnection>()
  constructor(private readonly dataRoot: string) {}
  private path(ownerId: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(ownerId)) throw new PersonalError('FORBIDDEN', 403)
    return join(this.dataRoot, `${ownerId}.json`)
  }
  forOwner(ownerId: string) {
    let connection = this.connections.get(ownerId)
    if (!connection) {
      let config: CentralConfig | null = null
      try { config = readPrivateConfig(this.path(ownerId)) as unknown as CentralConfig }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      connection = new CentralConnection(config); this.connections.set(ownerId, connection)
    }
    return connection
  }
  async connect(ownerId: string, value: unknown) {
    const input = value as Record<string, unknown>
    if (!plainJson(value) || !matchesSchema(value, schema.$defs.ConnectionRequest, schema)) throw new PersonalError('INVALID_REQUEST')
    const login = await centralJson(input.origin as string, '/api/auth/login', null, { username: input.username, password: input.password })
    const config: CentralConfig = { origin: input.origin as string, token: login?.token, principalId: login?.userId,
      profile: input.profile as string, sessionId: input.sessionId as string, ...(input.taskId ? { taskId: input.taskId as string } : {}) }
    const connection = new CentralConnection(config)
    const state = await connection.state()
    if (!state.connected) { connection.close(); throw new PersonalError(state.error || 'CENTRAL_UNAVAILABLE', 403) }
    const path = this.path(ownerId); mkdirSync(this.dataRoot, { recursive: true, mode: 0o700 })
    const temp = `${path}.${randomUUID()}.tmp`
    try { writeFileSync(temp, JSON.stringify(config), { mode: 0o600, flag: 'wx' }); renameSync(temp, path) }
    catch { connection.close(); throw new PersonalError('IO_FAILURE', 500) }
    this.connections.get(ownerId)?.close(); this.connections.set(ownerId, connection)
    return state
  }
  close() { for (const connection of this.connections.values()) connection.close(); this.connections.clear() }
}
