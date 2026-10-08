import { approvedOrigin } from './receiver'
import { PersonalError, limits, parseRequest, validateResponse, matchesSchema, protocolSchema, plainJson, type FileResponse } from './protocol'

export interface ClientConfig {
  origin: string; deviceId: string; workspaceId: string; ownerId: string; sourceDeviceId: string; sourceOrigin: string; credential: string
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!/^application\/json(?:\s*;.*)?$/i.test(response.headers.get('content-type') || '') || !response.body) throw new PersonalError('INVALID_RESPONSE', 502)
  const reader = response.body.getReader()
  let size = 0
  const chunks: Buffer[] = []
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      size += item.value.length
      if (size > limits.maxResponseBytes) throw new PersonalError('INVALID_RESPONSE', 502)
      chunks.push(Buffer.from(item.value))
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } catch { throw new PersonalError('INVALID_RESPONSE', 502) }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
export class PersonalClient {
  private readonly config: Readonly<ClientConfig>
  readonly deviceId: string
  readonly workspaceId: string
  readonly ownerId: string
  constructor(config: ClientConfig) {
    if (!plainJson(config) || !['deviceId', 'workspaceId', 'ownerId', 'sourceDeviceId'].every(key =>
      matchesSchema(config[key as keyof ClientConfig], protocolSchema.$defs.Id)) || !/^[a-f0-9]{64}$/.test(config.credential)) throw new PersonalError('INVALID_CONFIGURATION')
    approvedOrigin(config.origin); approvedOrigin(config.sourceOrigin)
    this.config = Object.freeze({ ...config })
    this.deviceId = config.deviceId
    this.workspaceId = config.workspaceId
    this.ownerId = config.ownerId
  }
  private async fetch(path: '/v1/operations' | '/v1/workspaces', payload?: unknown): Promise<unknown> {
    const config = this.config
    try {
      const response = await fetch(`${config.origin}${path}`, { method: payload ? 'POST' : 'GET', redirect: 'error',
        signal: AbortSignal.timeout(5000), headers: { Authorization: `Bearer ${config.credential}`, 'X-Personal-Origin': config.sourceOrigin,
          ...(payload ? { 'Content-Type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) })
      const data = await boundedJson(response)
      if (!response.ok) {
        const error = (data as { error?: { code?: unknown } })?.error?.code
        if (typeof error !== 'string' || !/^[A-Z_]{1,64}$/.test(error)) throw new PersonalError('INVALID_RESPONSE', 502)
        throw new PersonalError(error, response.status)
      }
      return data
    } catch (error) {
      if (error instanceof PersonalError) throw error
      // The caller must consult status using the same target/operationId. No automatic transport or device fallback.
      throw new PersonalError('TRANSPORT_UNKNOWN', 502)
    }
  }
  async execute(ownerId: string, input: unknown): Promise<FileResponse> {
    const request = parseRequest(input)
    if (ownerId !== this.config.ownerId || request.deviceId !== this.config.deviceId || request.workspaceId !== this.config.workspaceId) throw new PersonalError('FORBIDDEN', 403)
    const result = validateResponse(await this.fetch('/v1/operations', request))
    if (result.target.deviceId !== request.deviceId || result.target.workspaceId !== request.workspaceId ||
        result.operationId !== request.operationId || result.action !== request.action) throw new PersonalError('INVALID_RESPONSE', 502)
    return result
  }
  async stateFor(ownerId: string) {
    if (ownerId !== this.ownerId) throw new PersonalError('FORBIDDEN', 403)
    const state = await this.fetch('/v1/workspaces')
    if (!plainJson(state) || !matchesSchema(state, protocolSchema.$defs.PeerState)) throw new PersonalError('INVALID_RESPONSE', 502)
    const typed = state as { version: 1; deviceId: string; hostname: string; workspaces: { id: string; deviceId: string; hostname: string; label: string; capabilities: string[]; grantRevision: number; workspaceRevision: number }[] }
    if (typed.deviceId !== this.deviceId || typed.workspaces.some(item => item.deviceId !== this.deviceId || item.id !== this.workspaceId)) throw new PersonalError('INVALID_RESPONSE', 502)
    return typed
  }
}
