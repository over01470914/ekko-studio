import { io, type Socket } from 'socket.io-client'
import { PersonalError, approvedOrigin } from '../../../../../../personal-assistant/src'

export interface CentralConfig { origin: string; token: string; principalId: number; profile: string; sessionId: string; taskId?: string }
export interface CentralEvent { sequence: number; event: string; sessionId: string; data: Record<string, unknown> }
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const events = ['run.started', 'message.delta', 'message.interim', 'run.completed', 'run.failed', 'run.queued', 'usage.updated']

// This adapter owns observers and an origin-bound account credential, never an Agent/Bridge.
export class CentralConnection {
  private readonly config: Readonly<CentralConfig> | null
  private socket: Socket | null = null
  private sequence = 0
  private readonly listeners = new Set<(event: CentralEvent) => void>()
  private readonly buffer: CentralEvent[] = []
  private closed = false
  private attaching: Promise<void> | null = null
  constructor(config: CentralConfig | null) {
    if (config) {
      try { approvedOrigin(config.origin) } catch { throw new PersonalError('CENTRAL_CONFIGURATION') }
      if (!Number.isSafeInteger(config.principalId) || config.principalId < 1 || !validId(config.profile) || !validId(config.sessionId) ||
        (config.taskId !== undefined && !validId(config.taskId)) ||
        typeof config.token !== 'string' || !config.token || config.token.length > 8192 || /[\r\n]/.test(config.token)) throw new PersonalError('CENTRAL_CONFIGURATION')
    }
    this.config = config ? Object.freeze({ ...config }) : null
  }
  private required() {
    if (!this.config || this.closed) throw new PersonalError('CENTRAL_UNAVAILABLE', 503)
    return this.config
  }
  private async request(path: string, token: string, options?: { body: unknown }) {
    const config = this.required()
    return centralJson(config.origin, path, token, options?.body, config.profile)
  }
  private async verify() {
    const config = this.required()
    const account = await this.request('/api/auth/me', config.token)
    const profiles = await this.request('/api/hermes/profiles', config.token)
    if (account?.user?.id !== config.principalId || account.user.status !== 'active' ||
      !Array.isArray(profiles?.profiles) || !profiles.profiles.some((profile: { name?: string }) => profile.name === config.profile)) throw new PersonalError('CENTRAL_IDENTITY', 403)
    const history = await this.request(`/api/studio/sessions/${config.sessionId}`, config.token)
    const session = history?.session
    const owner = session?.user_id
    const ownerMatches = owner === String(config.principalId)
    if (session?.id !== config.sessionId || session.profile !== config.profile || !ownerMatches) throw new PersonalError('CENTRAL_IDENTITY', 403)
    return { account, history }
  }
  async state() {
    if (!this.config) return { version: 1, configured: false, connected: false }
    try {
      const { account } = await this.verify()
      return { version: 1, configured: true, connected: true, origin: this.config.origin,
        principal: { id: account.user.id, username: String(account.user.username || '') }, profile: this.config.profile,
        sessionId: this.config.sessionId, ...(this.config.taskId ? { clientTaskId: this.config.taskId } : {}) }
    } catch (error) {
      return { version: 1, configured: true, connected: false, error: error instanceof PersonalError ? error.code : 'CENTRAL_UNAVAILABLE' }
    }
  }
  async history() {
    const { history } = await this.verify()
    // Only message content and stable authority labels cross back to the renderer, never central workspace/config paths.
    const config = this.required()
    return { session: { id: config.sessionId, profile: config.profile, title: String(history.session.title || ''),
      messages: (Array.isArray(history.session.messages) ? history.session.messages : []).slice(-200).map((message: Record<string, unknown>) =>
        ({ id: message.id, role: message.role, content: typeof message.content === 'string' ? message.content : '' })) } }
  }
  private publish(event: string, data: Record<string, unknown>) {
    const record = { sequence: ++this.sequence, event, sessionId: this.required().sessionId, data }
    this.buffer.push(record)
    if (this.buffer.length > 200) this.buffer.shift()
    for (const listener of this.listeners) listener(record)
  }
  private async attach() {
    if (this.attaching) return this.attaching
    if (this.socket) return
    this.attaching = (async () => {
      await this.verify()
      if (this.closed) return
      const config = this.required()
      const socket = io(`${config.origin}/chat-run`, { auth: { token: config.token }, query: { profile: config.profile },
        transports: ['websocket'], autoConnect: false, reconnection: true, reconnectionAttempts: 10, timeout: 8000,
        transportOptions: { websocket: { rejectUnauthorized: true, followRedirects: false } } })
      this.socket = socket
      socket.on('connect', () => {
        // Resume only observes existing state. A reconnect never sends run, cancel, or a file operation.
        void this.verify().then(() => { if (this.socket === socket && socket.connected) socket.emit('resume', { session_id: config.sessionId }) })
          .catch(() => { socket.disconnect(); this.publish('connection.failed', { code: 'CENTRAL_IDENTITY' }) })
      })
      socket.on('connect_error', () => this.publish('connection.failed', { code: 'CENTRAL_UNAVAILABLE' }))
      for (const event of events) socket.on(event, (data: Record<string, unknown>) => {
        if (!data || data.session_id !== config.sessionId || this.socket !== socket) return
        const safe: Record<string, unknown> = {}
        for (const key of ['delta', 'text', 'output', 'run_id', 'queue_id']) if (typeof data[key] === 'string') safe[key] = data[key]
        if (event === 'run.failed') safe.code = 'CENTRAL_RUN_FAILED'
        this.publish(event, safe)
      })
      socket.connect()
    })().finally(() => { this.attaching = null })
    return this.attaching
  }
  async subscribe(listener: (event: CentralEvent) => void, after = 0) {
    await this.attach()
    this.listeners.add(listener)
    for (const event of this.buffer) if (event.sequence > after) listener(event)
    return () => this.listeners.delete(listener)
  }
  async send(input: string) {
    if (typeof input !== 'string' || !input.trim() || input.length > 32768) throw new PersonalError('INVALID_REQUEST')
    await this.verify(); await this.attach()
    // Do not enqueue in Socket.IO's offline buffer. Unknown submission is never retried automatically.
    if (!this.socket?.connected) throw new PersonalError('CENTRAL_UNAVAILABLE', 503)
    this.socket.emit('run', { session_id: this.required().sessionId, input: input.trim() })
    return { version: 1, accepted: true, sessionId: this.required().sessionId }
  }
  close() { this.closed = true; this.listeners.clear(); this.socket?.disconnect(); this.socket = null }
}

export async function centralJson(origin: string, path: string, token: string | null, body?: unknown, profile?: string): Promise<any> {
  try { approvedOrigin(origin) } catch { throw new PersonalError('CENTRAL_CONFIGURATION') }
  if (!/^\/api\/(auth\/(login|me)|hermes\/profiles|studio\/sessions\/[A-Za-z0-9_-]{1,128})$/.test(path)) throw new PersonalError('CENTRAL_CONFIGURATION')
  try {
    const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
      signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(profile ? { 'X-Hermes-Profile': profile } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (response.status >= 300 && response.status < 400) throw new PersonalError('CENTRAL_REDIRECT', 502)
    if (!response.ok) throw new PersonalError(response.status === 401 || response.status === 403 ? 'CENTRAL_AUTH' : 'CENTRAL_UNAVAILABLE', response.status === 401 || response.status === 403 ? 403 : 503)
    if (!response.headers.get('content-type')?.includes('application/json')) throw new PersonalError('CENTRAL_RESPONSE', 502)
    const reader = response.body?.getReader(); if (!reader) throw new PersonalError('CENTRAL_RESPONSE', 502)
    const chunks: Uint8Array[] = []; let size = 0
    try {
      while (true) { const result = await reader.read(); if (result.done) break; size += result.value.length
        if (size > 2 * 1024 * 1024) throw new PersonalError('CENTRAL_RESPONSE', 502)
        chunks.push(result.value) }
    } finally { await reader.cancel() }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) { throw error instanceof PersonalError ? error : new PersonalError('CENTRAL_UNAVAILABLE', 503) }
}
