import { createServer, type IncomingMessage } from 'node:http'
import { PersonalReceiver } from './receiver'
import { PersonalError, limits } from './protocol'

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0; let settled = false
    request.on('data', (chunk: Buffer) => {
      if (settled) return
      size += chunk.length
      if (size > limits.maxRequestBytes) { settled = true; chunks.length = 0; reject(new PersonalError('LIMIT_EXCEEDED', 413)); return }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (settled) return
      settled = true
      try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))) }
      catch { reject(new PersonalError('INVALID_REQUEST')) }
    })
    request.on('error', () => { if (!settled) { settled = true; reject(new PersonalError('INVALID_REQUEST')) } })
    request.on('aborted', () => { if (!settled) { settled = true; reject(new PersonalError('INVALID_REQUEST')) } })
  })
}
export function createReceiverServer(receiver: PersonalReceiver) {
  const server = createServer(async (request, response) => {
    const send = (status: number, data: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      response.end(JSON.stringify(data))
    }
    try {
      if (!(request.method === 'POST' && request.url === '/v1/operations') &&
          !(request.method === 'GET' && request.url === '/v1/workspaces')) throw new PersonalError('NOT_FOUND', 404)
      // Browser-origin traffic is not a file-tool credential transport. No CORS, cookies or JWT forwarding.
      if (request.headers.origin) throw new PersonalError('FORBIDDEN', 403)
      const authorization = request.headers.authorization || ''
      const origin = request.headers['x-personal-origin']
      if (!/^Bearer [a-f0-9]{64}$/.test(authorization) || typeof origin !== 'string') throw new PersonalError('UNAUTHORIZED', 401)
      const peer = receiver.authenticate(authorization.slice(7), origin)
      if (request.method === 'GET') { send(200, receiver.stateForPeer(peer)); return }
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) throw new PersonalError('INVALID_REQUEST')
      const length = Number(request.headers['content-length'])
      if (Number.isFinite(length) && length > limits.maxRequestBytes) throw new PersonalError('LIMIT_EXCEEDED', 413)
      send(200, receiver.execute(peer, await readJson(request)))
    } catch (error) {
      const safe = error instanceof PersonalError ? error : new PersonalError('IO_FAILURE', 500)
      send(safe.status, { version: 1, error: { code: safe.code } })
    }
  })
  server.maxConnections = 16
  server.headersTimeout = 5000
  server.requestTimeout = 5000
  server.keepAliveTimeout = 1000
  server.setTimeout(5000, socket => socket.destroy())
  return server
}
