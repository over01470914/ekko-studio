import { PersonalClient, type ClientConfig } from './client'
import { readPrivateConfig } from './private-config'
import { PersonalError, plainJson, protocolSchema, parseRequest, limits, type FileRequest } from './protocol'

const toolActions = { personal_search: 'search', personal_read: 'read', personal_write: 'write', personal_delete: 'delete', personal_operation_status: 'status' } as const
const inputSchemas = { search: protocolSchema.$defs.Search, read: protocolSchema.$defs.Read,
  write: { type: 'object', oneOf: [protocolSchema.$defs.Create, protocolSchema.$defs.Overwrite] },
  delete: protocolSchema.$defs.Delete, status: protocolSchema.$defs.Status }
const descriptions = {
  search: 'Search filenames and UTF-8 content within an explicitly granted device/workspace. Bounded scan; inspect truncated/hasMore.',
  read: 'Read a bounded UTF-8 byte range and full-file SHA-256. Not an Office/PDF parser; sensitive/binary files are denied.',
  write: 'Atomic create-only or expected-SHA256 overwrite on the exact approved target. Unknown state requires status, never blind retry.',
  delete: 'Soft-delete one regular file with expected SHA-256 and an owner-confirmed, target/path/operation-bound confirmationId. Cannot mint confirmations.',
  status: 'Query a durable operation receipt on the same target. Unknown means do not redispatch on any device/transport.',
}
export function createMcpSession(clients: PersonalClient | readonly PersonalClient[], ownerId: string) {
  const targets = Array.isArray(clients) ? clients : [clients]
  let initialized = false
  let ready = false
  return {
    async handle(message: unknown): Promise<any> {
      const safeId = message && typeof message === 'object' && 'id' in message &&
        ((typeof message.id === 'string' && message.id.length <= 64) || (typeof message.id === 'number' && Number.isSafeInteger(message.id))) ? message.id : null
      const failure = (code: number, text: string) => ({ jsonrpc: '2.0', id: safeId, error: { code, message: text } })
      if (!plainJson(message) || !message || typeof message !== 'object' || Array.isArray(message)) return failure(-32600, 'INVALID_REQUEST')
      const rpc = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
      if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string' || Object.keys(rpc).some(key => !['jsonrpc', 'id', 'method', 'params'].includes(key))) return failure(-32600, 'INVALID_REQUEST')
      const notification = !Object.hasOwn(rpc, 'id')
      if (notification) {
        if (rpc.method === 'notifications/initialized' && initialized) ready = true
        return null
      }
      if (safeId === null) return failure(-32600, 'INVALID_REQUEST')
      const response = (result: unknown) => ({ jsonrpc: '2.0', id: safeId, result })
      if (rpc.method === 'initialize') {
        if (initialized || !rpc.params || typeof rpc.params !== 'object' || Array.isArray(rpc.params)) return failure(-32602, 'INVALID_PARAMS')
        const params = rpc.params as Record<string, unknown>
        if (typeof params.protocolVersion !== 'string' || !params.clientInfo || !params.capabilities) return failure(-32602, 'INVALID_PARAMS')
        initialized = true
        const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
        return response({ protocolVersion: versions.includes(params.protocolVersion) ? params.protocolVersion : versions[0],
          capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'ekko-personal-assistant', version: '0.1.0' } })
      }
      if (rpc.method === 'ping') return response({})
      if (!ready) return failure(-32000, 'NOT_INITIALIZED')
      if (rpc.method === 'tools/list') return response({ tools: Object.entries(toolActions).map(([name, action]) => ({ name,
        description: descriptions[action], inputSchema: { ...inputSchemas[action], $defs: protocolSchema.$defs } })) })
      if (rpc.method !== 'tools/call') return failure(-32601, 'METHOD_NOT_FOUND')
      try {
        if (!rpc.params || typeof rpc.params !== 'object' || Array.isArray(rpc.params)) throw new PersonalError('INVALID_REQUEST')
        const params = rpc.params as Record<string, unknown>
        if (typeof params.name !== 'string' || !(params.name in toolActions) || Object.keys(params).some(key => !['name', 'arguments', '_meta'].includes(key))) throw new PersonalError('INVALID_REQUEST')
        const request = parseRequest(params.arguments)
        if (request.action !== toolActions[params.name as keyof typeof toolActions]) throw new PersonalError('INVALID_REQUEST')
        const client = targets.find(target => target.deviceId === request.deviceId && target.workspaceId === request.workspaceId && target.ownerId === ownerId)
        if (!client) throw new PersonalError('FORBIDDEN', 403)
        const result = await client.execute(ownerId, request)
        return response({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result,
          ...(result.outcome === 'unknown' ? { isError: true } : {}) })
      } catch (error) {
        const code = error instanceof PersonalError ? error.code : 'TOOL_FAILED'
        return response({ content: [{ type: 'text', text: code }], isError: true })
      }
    },
  }
}
export function runMcpStdio(clients: readonly PersonalClient[], ownerId: string): void {
  const session = createMcpSession(clients, ownerId)
  let buffer = Buffer.alloc(0)
  let queue = Promise.resolve()
  let pending = 0
  const failClosed = () => { process.stdin.destroy(); process.exitCode = 1 }
  process.stdin.on('data', (chunk: Buffer) => {
    if (buffer.length + chunk.length > limits.maxRequestBytes * 2) { failClosed(); return }
    buffer = Buffer.concat([buffer, chunk])
    let newline: number
    while ((newline = buffer.indexOf(10)) >= 0) {
      const line = buffer.subarray(0, newline)
      buffer = buffer.subarray(newline + 1)
      if (line.length > limits.maxRequestBytes || pending >= 8) { failClosed(); return }
      if (!line.length) continue
      pending++
      queue = queue.then(async () => {
        let reply
        try { reply = await session.handle(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line))) }
        catch { reply = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'PARSE_ERROR' } } }
        if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`)
      }).finally(() => { pending-- })
    }
    if (buffer.length > limits.maxRequestBytes) failClosed()
  })
  process.stdin.on('end', () => { if (buffer.length) process.exitCode = 1 })
}
if (require.main === module) {
  try {
    const config = readPrivateConfig(process.argv[2])
    if (config.version !== 1 || typeof config.ownerId !== 'string' || !Array.isArray(config.peers) || !config.peers.length || config.peers.length > 16) throw new PersonalError('INVALID_CONFIGURATION')
    const clients = config.peers.map(peer => new PersonalClient(peer as ClientConfig))
    runMcpStdio(clients, config.ownerId)
  } catch { process.stderr.write('PERSONAL_MCP_START_FAILED\n'); process.exitCode = 1 }
}
