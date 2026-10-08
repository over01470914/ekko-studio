import { mkdirSync, closeSync, writeFileSync, fsyncSync, fstatSync, constants } from 'node:fs'
import { join } from 'node:path'
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { ReceiptStore } from './receipts'
import { bindRoot, assertRoot, contained, validatePath, anchorFile, anchorDirectory, readAnchored, readRegular, inspectText, type RootBinding } from './files'
import { posix, fileRevision, type FileRevision } from './posix'
import { PersonalError, sha256, canonical, parseRequest, validateResponse, matchesSchema, protocolSchema, limits, plainJson,
  type Capability, type FileRequest, type FileResponse, type ResultData, type SearchItem } from './protocol'

export interface WorkspaceConfig { id: string; ownerId: string; root: string; label: string }
export interface PeerApproval { id: string; ownerId: string; sourceDeviceId: string; sourceOrigin: string; workspaceId: string; token: string; capabilities: readonly Capability[] }
export interface ReceiverConfig { stateRoot: string; deviceId: string; hostname: string; workspaces: WorkspaceConfig[]; approvals: PeerApproval[] }
export interface AuthenticatedPeer { readonly ownerId: string; readonly sourceDeviceId: string; readonly grantId: string }
interface Principal extends AuthenticatedPeer { credentialHash: string; sourceOrigin: string }
interface Grant { id: string; binding: string; capabilities: string; revision: number }
interface Operation { id: string; owner: string; source: string; workspace: string; payload_hash: string; state: string; result: string | null; code: string | null }
interface Workspace extends WorkspaceConfig { binding: RootBinding }

export function approvedOrigin(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new PersonalError('INVALID_CONFIGURATION') }
  if (url.origin !== value || url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) throw new PersonalError('INVALID_CONFIGURATION')
  return value
}
const validId = (id: unknown) => matchesSchema(id, protocolSchema.$defs.Id)
const validCaps = (caps: unknown): caps is Capability[] => Array.isArray(caps) && caps.length <= 4 &&
  new Set(caps).size === caps.length && caps.every(cap => matchesSchema(cap, protocolSchema.$defs.Capability))
const errorCode = (error: unknown) => error instanceof PersonalError ? error.code :
  (error as NodeJS.ErrnoException)?.code === 'REVISION_MISMATCH' ? 'FILE_CHANGED' :
  (error as NodeJS.ErrnoException)?.code === 'EEXIST' ? 'CONFLICT' : 'IO_FAILURE'

export class PersonalReceiver {
  private readonly store!: ReceiptStore
  private readonly workspaces = new Map<string, Workspace>()
  private readonly approvals = new Map<string, Omit<PeerApproval, 'token'> & { tokenHash: string }>()
  private readonly authenticated = new WeakSet<object>()
  private readonly locks = new Set<string>()
  private readonly stateBinding: RootBinding
  private readonly trashBinding: RootBinding
  private closed = false
  readonly deviceId: string
  readonly hostname: string
  constructor(config: ReceiverConfig) {
    // Reparse/junction guarantees are not inferred from POSIX O_NOFOLLOW. This pilot fails closed on Windows.
    if (process.platform === 'win32') throw new PersonalError('PLATFORM_UNVERIFIED', 503)
    posix()
    if (!plainJson(config) || !validId(config.deviceId) || typeof config.hostname !== 'string' || !config.hostname ||
        config.hostname.length > 128 || /[\x00-\x1f]/.test(config.hostname) || !Array.isArray(config.workspaces) ||
        config.workspaces.length > 8 || !Array.isArray(config.approvals) || config.approvals.length > 16) throw new PersonalError('INVALID_CONFIGURATION')
    this.deviceId = config.deviceId
    this.hostname = config.hostname
    try {
      for (const item of config.workspaces) {
        if (!validId(item.id) || !validId(item.ownerId) || typeof item.label !== 'string' || item.label.length > 128 ||
            this.workspaces.has(item.id)) throw new PersonalError('INVALID_CONFIGURATION')
        const binding = bindRoot(item.root)
        if ([...this.workspaces.values()].some(other => contained(other.binding.root, binding.root) || contained(binding.root, other.binding.root))) throw new PersonalError('INVALID_CONFIGURATION')
        this.workspaces.set(item.id, { ...item, binding })
      }
      // Validate non-overlap before creating private state, including absent state roots.
      const stateRoot = join(config.stateRoot)
      if (!stateRoot.startsWith('/') || [...this.workspaces.values()].some(item => contained(item.binding.root, stateRoot) || contained(stateRoot, item.binding.root))) throw new PersonalError('INVALID_CONFIGURATION')
      this.store = new ReceiptStore(stateRoot)
      this.stateBinding = bindRoot(stateRoot)
      if ([...this.workspaces.values()].some(item => contained(item.binding.root, this.stateBinding.root) ||
          contained(this.stateBinding.root, item.binding.root) || item.binding.dev !== this.stateBinding.dev)) throw new PersonalError('INVALID_CONFIGURATION')
      const trashRoot = join(this.stateBinding.root, 'trash')
      mkdirSync(trashRoot, { mode: 0o700, recursive: true })
      this.trashBinding = bindRoot(trashRoot)
      const installation = canonical({ deviceId: config.deviceId, hostname: config.hostname,
        // Preserve the existing private installation receipt exactly; runtime
        // comparisons use bigint and bindRoot rejects unsafe JSON-number IDs.
        workspaces: [...this.workspaces.values()].map(({ id, ownerId, label, binding }) => ({ id, ownerId, label,
          binding: { root: binding.root, dev: Number(binding.dev), ino: Number(binding.ino) } })) })
      const previous = this.store.db.prepare('SELECT value FROM meta WHERE key=?').get('installation') as { value: string } | undefined
      if (previous && previous.value !== installation) throw new PersonalError('INSTALLATION_MISMATCH', 409)
      if (!previous) this.store.db.prepare('INSERT INTO meta VALUES (?,?)').run('installation', installation)
      for (const workspace of this.workspaces.values()) this.store.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run(`revision:${workspace.id}`, '1')
      for (const approval of config.approvals) {
        const workspace = this.workspaces.get(approval.workspaceId)
        if (!validId(approval.id) || !validId(approval.ownerId) || !validId(approval.sourceDeviceId) || !workspace ||
            workspace.ownerId !== approval.ownerId || this.approvals.has(approval.id) || !validCaps(approval.capabilities) ||
            typeof approval.token !== 'string' || !/^[a-f0-9]{64}$/.test(approval.token)) throw new PersonalError('INVALID_CONFIGURATION')
        approvedOrigin(approval.sourceOrigin)
        const { token, ...publicBinding } = approval
        const binding = { ...publicBinding, tokenHash: sha256(token) }
        this.approvals.set(approval.id, binding)
        const { capabilities: _capabilities, ...grantBinding } = binding
        const serialized = canonical(grantBinding)
        // A changed credential/origin/install binding requires explicit re-onboarding, not a silent reset.
        const existing = this.store.db.prepare('SELECT * FROM grants WHERE id=?').get(approval.id) as unknown as Grant | undefined
        if (existing && existing.binding !== serialized) throw new PersonalError('APPROVAL_MISMATCH', 409)
        if (!existing) this.store.db.prepare('INSERT INTO grants VALUES (?,?,?,?)').run(approval.id, serialized, JSON.stringify(approval.capabilities), 1)
      }
    } catch (error) {
      this.store?.close()
      if (error instanceof PersonalError) throw error
      throw new PersonalError('INVALID_CONFIGURATION')
    }
  }
  close(): void { if (!this.closed) { this.closed = true; this.store.close() } }
  authenticate(token: string, sourceOrigin: string): AuthenticatedPeer {
    if (this.closed || typeof token !== 'string' || token.length !== 64) throw new PersonalError('UNAUTHORIZED', 401)
    const hash = sha256(token)
    const approval = [...this.approvals.values()].find(item => item.sourceOrigin === sourceOrigin &&
      timingSafeEqual(Buffer.from(item.tokenHash, 'hex'), Buffer.from(hash, 'hex')))
    if (!approval) throw new PersonalError('UNAUTHORIZED', 401)
    const principal: Principal = Object.freeze({ ownerId: approval.ownerId, sourceDeviceId: approval.sourceDeviceId,
      grantId: approval.id, credentialHash: hash, sourceOrigin })
    this.authenticated.add(principal)
    return principal
  }
  private authorize(peer: AuthenticatedPeer, request: FileRequest): { workspace: Workspace; grant: Grant } {
    if (this.closed || !peer || !this.authenticated.has(peer)) throw new PersonalError('UNAUTHORIZED', 401)
    const principal = peer as Principal
    const approval = this.approvals.get(peer.grantId)
    const workspace = this.workspaces.get(request.workspaceId)
    if (!approval || approval.tokenHash !== principal.credentialHash || approval.sourceOrigin !== principal.sourceOrigin ||
        request.deviceId !== this.deviceId || !workspace || workspace.ownerId !== peer.ownerId ||
        approval.workspaceId !== request.workspaceId || approval.sourceDeviceId !== peer.sourceDeviceId) throw new PersonalError('FORBIDDEN', 403)
    const grant = this.store.db.prepare('SELECT * FROM grants WHERE id=?').get(peer.grantId) as unknown as Grant | undefined
    if (!grant || grant.revision !== request.grantRevision) throw new PersonalError('GRANT_MISMATCH', 403)
    const capabilities = JSON.parse(grant.capabilities) as Capability[]
    if (!capabilities.length || (request.action !== 'status' && !capabilities.includes(request.action))) throw new PersonalError('CAPABILITY_DENIED', 403)
    assertRoot(this.stateBinding)
    assertRoot(this.trashBinding)
    assertRoot(workspace.binding)
    return { workspace, grant }
  }
  stateFor(ownerId: string) {
    const grants = [...this.approvals.values()].filter(item => item.ownerId === ownerId).map(item => {
      const grant = this.store.db.prepare('SELECT * FROM grants WHERE id=?').get(item.id) as unknown as Grant
      return { id: item.id, sourceDeviceId: item.sourceDeviceId, workspaceId: item.workspaceId,
        capabilities: JSON.parse(grant.capabilities) as Capability[], grantRevision: grant.revision }
    })
    return { version: 1 as const, configured: true, workspaces: [...this.workspaces.values()].filter(item => item.ownerId === ownerId).map(item => {
      const matching = grants.filter(grant => grant.workspaceId === item.id)
      return { id: item.id, deviceId: this.deviceId, hostname: this.hostname, label: item.label,
        capabilities: [...new Set(matching.flatMap(grant => grant.capabilities))], grantRevision: Math.max(1, ...matching.map(grant => grant.grantRevision)),
        workspaceRevision: this.revision(item.id) }
    }), peers: [], grants }
  }
  stateForPeer(peer: AuthenticatedPeer) {
    if (!peer || !this.authenticated.has(peer)) throw new PersonalError('UNAUTHORIZED', 401)
    const approval = this.approvals.get(peer.grantId)!
    const grant = this.store.db.prepare('SELECT * FROM grants WHERE id=?').get(peer.grantId) as unknown as Grant
    const request = { version: 1, operationId: randomUUID(), deviceId: this.deviceId, workspaceId: approval.workspaceId,
      grantRevision: grant.revision, action: 'status' } as const
    this.authorize(peer, request)
    const workspace = this.workspaces.get(approval.workspaceId)!
    return { version: 1, deviceId: this.deviceId, hostname: this.hostname, workspaces: [{ id: workspace.id, deviceId: this.deviceId,
      hostname: this.hostname, label: workspace.label, capabilities: JSON.parse(grant.capabilities), grantRevision: grant.revision,
      workspaceRevision: this.revision(workspace.id) }] }
  }
  setGrant(ownerId: string, id: string, expectedRevision: number, capabilities: readonly Capability[]) {
    const approval = this.approvals.get(id)
    if (!approval || approval.ownerId !== ownerId) throw new PersonalError('FORBIDDEN', 403)
    if (!validCaps(capabilities) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new PersonalError('INVALID_REQUEST')
    const result = this.store.db.prepare('UPDATE grants SET capabilities=?,revision=revision+1 WHERE id=? AND revision=?').run(JSON.stringify(capabilities), id, expectedRevision)
    if (!result.changes) throw new PersonalError('CONFLICT', 409)
    return { id, capabilities: [...capabilities], grantRevision: expectedRevision + 1 }
  }
  private revision(workspaceId: string): number {
    return Number((this.store.db.prepare('SELECT value FROM meta WHERE key=?').get(`revision:${workspaceId}`) as { value: string }).value)
  }
  private bump(workspaceId: string): number {
    const value = this.revision(workspaceId) + 1
    this.store.db.prepare('UPDATE meta SET value=? WHERE key=?').run(String(value), `revision:${workspaceId}`)
    return value
  }
  private operationKey(peer: AuthenticatedPeer, request: FileRequest) { return sha256(canonical([peer.ownerId, peer.sourceDeviceId, request.operationId])) }
  private response(request: FileRequest, data: ResultData, outcome: 'completed' | 'unknown' = 'completed'): FileResponse {
    return validateResponse({ version: 1, operationId: request.operationId, target: { deviceId: this.deviceId, hostname: this.hostname,
      workspaceId: request.workspaceId }, outcome, action: request.action, data })
  }
  // Durable prepare phase. A reservation left without a receipt is UNKNOWN, never permission to retry a mutation.
  reserveOperation(peer: AuthenticatedPeer, value: unknown): void {
    const request = parseRequest(value)
    this.authorize(peer, request)
    if (request.action === 'status') throw new PersonalError('INVALID_REQUEST')
    this.store.reserve(this.operationKey(peer, request), peer.ownerId, peer.sourceDeviceId, request.workspaceId, sha256(canonical(request)))
  }
  execute(peer: AuthenticatedPeer, value: unknown): FileResponse {
    const request = parseRequest(value)
    const { workspace } = this.authorize(peer, request)
    const key = this.operationKey(peer, request)
    const previous = this.store.db.prepare('SELECT * FROM operations WHERE id=?').get(key) as unknown as Operation | undefined
    if (previous && previous.workspace !== request.workspaceId) throw new PersonalError('OPERATION_CONFLICT', 409)
    if (request.action === 'status') return this.response(request, { state: !previous ? 'not-found' :
      previous.state === 'pending' ? 'unknown' : previous.state as 'completed' | 'unknown' | 'rejected', ...(previous?.code ? { code: previous.code } : {}) })
    if (previous) {
      if (previous.payload_hash !== sha256(canonical(request))) throw new PersonalError('OPERATION_CONFLICT', 409)
      if (previous.state === 'rejected') throw new PersonalError(previous.code || 'REJECTED', 409)
      if (previous.state !== 'completed') return this.response(request, { state: 'unknown' }, 'unknown')
      return validateResponse(JSON.parse(previous.result!))
    }
    const pathKey = 'path' in request ? `${workspace.id}/${request.path}` : null
    if (pathKey && this.locks.has(pathKey)) throw new PersonalError('CONFLICT', 409)
    if (pathKey) this.locks.add(pathKey)
    let applied = false
    try {
      this.reserveOperation(peer, request)
      let data: ResultData
      if (request.action === 'search') data = this.search(workspace, request)
      else if (request.action === 'read') {
        const file = readRegular(workspace.binding, request.path)
        const offset = request.offset ?? 0
        let end = Math.min(file.bytes.length, offset + (request.length ?? limits.maxReadBytes))
        // Only an implicit upper bound backs off; an explicit misaligned range
        // or start offset is an error, never silently shifted.
        if (request.length === undefined && end < file.bytes.length) {
          while (end > offset && (file.bytes[end] & 0xc0) === 0x80) end--
        }
        const bytes = file.bytes.subarray(offset, end)
        let text: string
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new PersonalError('INVALID_RANGE') }
        data = { path: request.path, text, size: file.bytes.length, sha256: file.hash, offset, byteLength: bytes.length,
          truncated: offset > 0 || offset + bytes.length < file.bytes.length, encoding: 'utf8' }
      } else if (request.action === 'write') {
        const bytes = Buffer.from(request.content, 'utf8')
        if (bytes.length > limits.maxWriteBytes) throw new PersonalError('LIMIT_EXCEEDED', 413)
        inspectText(bytes)
        const { directory, name } = anchorFile(workspace.binding, request.path)
        const native = posix()
        const temp = `.pa-${randomUUID()}`
        let staged = false
        try {
          const checkTarget = () => {
            directory.assertCurrent()
            if (request.mode === 'overwrite') {
              const file = readAnchored(directory, name)
              if (file.hash !== request.expectedSha256) throw new PersonalError('CONFLICT', 409)
              return fileRevision(file.stat, file.bytes)
            } else {
              try { native.statAt(directory.fd, name); throw new PersonalError('CONFLICT', 409) }
              catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
            }
            return null
          }
          checkTarget()
          const fd = native.openAt(directory.fd, temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL)
          staged = true
          let stagedRevision: FileRevision
          try {
            directory.assertCurrent(); writeFileSync(fd, bytes); fsyncSync(fd)
            stagedRevision = fileRevision(fstatSync(fd, { bigint: true }), bytes)
          } finally { closeSync(fd) }
          this.authorize(peer, request)
          const targetRevision = checkTarget()
          // Crossing the first target-changing primitive is conservatively
          // uncertain even if a hook/IO failure prevents its return.
          applied = true
          try {
            if (request.mode === 'overwrite') {
              native.renameAt(directory.fd, temp, directory.fd, name, stagedRevision, targetRevision)
              staged = false
            } else {
              native.linkAt(directory.fd, temp, directory.fd, name, stagedRevision, null)
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'REVISION_MISMATCH' ||
                (request.mode === 'create' && (error as NodeJS.ErrnoException).code === 'EEXIST')) applied = false
            throw error
          }
          // Cleanup is outside the transfer's proven pre-apply rejection seam.
          if (request.mode === 'create') { native.unlinkAt(directory.fd, temp); staged = false }
          fsyncSync(directory.fd)
          const readback = readAnchored(directory, name)
          if (readback.hash !== sha256(bytes)) throw new PersonalError('FILE_CHANGED', 409)
          data = { path: request.path, size: readback.bytes.length, sha256: readback.hash, workspaceRevision: this.bump(workspace.id) }
        } finally {
          try {
            if (staged) try { native.unlinkAt(directory.fd, temp) }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
          } finally { directory.close() }
        }
      } else {
        const file = readRegular(workspace.binding, request.path)
        if (file.hash !== request.expectedSha256) throw new PersonalError('CONFLICT', 409)
        const confirmation = this.store.db.prepare('SELECT * FROM confirmations WHERE id=?').get(request.confirmationId) as { binding: string; expires: number; consumed: number } | undefined
        if (!confirmation || confirmation.consumed || confirmation.expires < Date.now() ||
            confirmation.binding !== this.confirmationBinding(peer.ownerId, peer.sourceDeviceId, request)) throw new PersonalError('CONFIRMATION_REQUIRED', 403)
        const receiptId = randomUUID()
        this.authorize(peer, request)
        const { directory, name } = anchorFile(workspace.binding, request.path)
        try {
          const trash = anchorDirectory(this.trashBinding)
          try {
            const before = readAnchored(directory, name)
            if (before.hash !== request.expectedSha256) throw new PersonalError('CONFLICT', 409)
            // Journal recovery cannot prove the filesystem/SQLite pair atomic.
            this.store.db.prepare('INSERT INTO trash VALUES (?,?,?,?,?,?,0)').run(receiptId, peer.ownerId, workspace.id, request.path, file.hash, request.operationId)
            directory.assertCurrent(); trash.assertCurrent()
            applied = true
            try { posix().renameAt(directory.fd, name, trash.fd, receiptId, fileRevision(before.stat, before.bytes), null) }
            catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'REVISION_MISMATCH' || (error as NodeJS.ErrnoException).code === 'EEXIST') {
                applied = false
                this.store.db.prepare('DELETE FROM trash WHERE id=?').run(receiptId)
              }
              throw error
            }
            fsyncSync(directory.fd); fsyncSync(trash.fd)
            const moved = readAnchored(trash, receiptId)
            if (moved.hash !== before.hash || moved.stat.dev !== before.stat.dev || moved.stat.ino !== before.stat.ino) throw new PersonalError('FILE_CHANGED', 409)
            directory.assertCurrent()
            this.store.db.prepare('UPDATE confirmations SET consumed=1 WHERE id=?').run(request.confirmationId)
            data = { path: request.path, sha256: file.hash, deleted: true, restorable: true, receiptId, workspaceRevision: this.bump(workspace.id) }
          } finally { trash.close() }
        } finally { directory.close() }
      }
      this.authorize(peer, request)
      const response = this.response(request, data)
      this.store.db.prepare('UPDATE operations SET state=?,result=? WHERE id=?').run('completed', JSON.stringify(response), key)
      return response
    } catch (error) {
      const code = errorCode(error)
      // If the receipt write also fails, the durable pending reservation itself
      // resolves to unknown. Never mask an applied mutation with an IO rejection.
      try { this.store.db.prepare('UPDATE operations SET state=?,code=? WHERE id=?').run(applied ? 'unknown' : 'rejected', code, key) } catch {}
      if (applied) return this.response(request, { state: 'unknown' }, 'unknown')
      throw new PersonalError(code, error instanceof PersonalError ? error.status : 409)
    } finally { if (pathKey) this.locks.delete(pathKey) }
  }
  private confirmationBinding(ownerId: string, sourceDeviceId: string, request: Record<string, unknown> | FileRequest): string {
    const { confirmationId: _confirmation, ...payload } = request as Record<string, unknown>
    return sha256(canonical({ ownerId, sourceDeviceId, payload }))
  }
  confirmDelete(ownerId: string, sourceDeviceId: string, value: unknown) {
    if (!plainJson(value) || !value || typeof value !== 'object' || Array.isArray(value) || Object.hasOwn(value, 'confirmationId')) throw new PersonalError('INVALID_REQUEST')
    const request = parseRequest({ ...value, confirmationId: randomUUID() })
    if (request.action !== 'delete') throw new PersonalError('INVALID_REQUEST')
    const workspace = this.workspaces.get(request.workspaceId)
    const approval = [...this.approvals.values()].find(item => item.ownerId === ownerId && item.sourceDeviceId === sourceDeviceId && item.workspaceId === request.workspaceId)
    if (!workspace || workspace.ownerId !== ownerId || !approval) throw new PersonalError('FORBIDDEN', 403)
    const grant = this.store.db.prepare('SELECT * FROM grants WHERE id=?').get(approval.id) as unknown as Grant
    if (request.deviceId !== this.deviceId || grant.revision !== request.grantRevision || !JSON.parse(grant.capabilities).includes('delete')) throw new PersonalError('GRANT_MISMATCH', 403)
    if (readRegular(workspace.binding, request.path).hash !== request.expectedSha256) throw new PersonalError('CONFLICT', 409)
    const confirmationId = randomUUID()
    const expiresAt = Date.now() + limits.confirmationTtlMs
    this.store.db.prepare('DELETE FROM confirmations WHERE expires<?').run(Date.now())
    const count = this.store.db.prepare('SELECT count(*) AS n FROM confirmations').get() as { n: number }
    if (count.n >= 1000) throw new PersonalError('CONFIRMATION_CAPACITY', 409)
    this.store.db.prepare('INSERT INTO confirmations (id,binding,expires) VALUES (?,?,?)').run(confirmationId, this.confirmationBinding(ownerId, sourceDeviceId, request), expiresAt)
    return { confirmationId, expiresAt, target: { deviceId: this.deviceId, hostname: this.hostname, workspaceId: workspace.id }, path: request.path, sha256: request.expectedSha256 }
  }
  restore(ownerId: string, receiptId: string): FileResponse {
    if (!matchesSchema(receiptId, protocolSchema.$defs.OperationId)) throw new PersonalError('INVALID_REQUEST')
    const receipt = this.store.db.prepare('SELECT * FROM trash WHERE id=?').get(receiptId) as { owner: string; workspace: string; path: string; hash: string; operation_id: string; restored: number } | undefined
    if (!receipt || receipt.owner !== ownerId || receipt.restored === 1) throw new PersonalError('FORBIDDEN', 403)
    const workspace = this.workspaces.get(receipt.workspace)!
    const envelope = { version: 1, operationId: receipt.operation_id, target: { deviceId: this.deviceId, hostname: this.hostname, workspaceId: workspace.id }, action: 'restore' }
    const unknown = () => validateResponse({ ...envelope, outcome: 'unknown', data: { state: 'unknown' } })
    // restored=2 is a durable restore reservation/unknown, not permission to
    // retry. This reuses the existing private receipt field, not a wire change.
    if (receipt.restored === 2) return unknown()
    assertRoot(this.stateBinding); assertRoot(this.trashBinding)
    const pathKey = `${workspace.id}/${receipt.path}`
    if (this.locks.has(pathKey)) throw new PersonalError('CONFLICT', 409)
    this.locks.add(pathKey)
    let applied = false
    try {
      const { directory, name } = anchorFile(workspace.binding, receipt.path)
      try {
        const trash = anchorDirectory(this.trashBinding)
        try {
          const source = readAnchored(trash, receiptId)
          if (source.hash !== receipt.hash) throw new PersonalError('FILE_CHANGED', 409)
          directory.assertCurrent(); trash.assertCurrent()
          this.store.db.prepare('UPDATE trash SET restored=2 WHERE id=?').run(receiptId)
          applied = true
          try { posix().linkAt(trash.fd, receiptId, directory.fd, name, fileRevision(source.stat, source.bytes), null) }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST' || (error as NodeJS.ErrnoException).code === 'REVISION_MISMATCH') {
              applied = false; this.store.db.prepare('UPDATE trash SET restored=0 WHERE id=?').run(receiptId)
            }
            throw error
          }
          posix().unlinkAt(trash.fd, receiptId)
          fsyncSync(directory.fd); fsyncSync(trash.fd)
          const readback = readAnchored(directory, name)
          if (readback.hash !== receipt.hash || readback.stat.dev !== source.stat.dev || readback.stat.ino !== source.stat.ino) throw new PersonalError('FILE_CHANGED', 409)
          const result = validateResponse({ ...envelope, outcome: 'completed', data: { path: receipt.path, size: readback.bytes.length, sha256: readback.hash, workspaceRevision: this.bump(workspace.id) } })
          this.store.db.prepare('UPDATE trash SET restored=1 WHERE id=?').run(receiptId)
          return result
        } finally { trash.close() }
      } finally { directory.close() }
    } catch (error) {
      if (applied) return unknown()
      throw new PersonalError(errorCode(error), error instanceof PersonalError ? error.status : 409)
    } finally { this.locks.delete(pathKey) }
  }
  private search(workspace: Workspace, request: Extract<FileRequest, { action: 'search' }>): ResultData {
    const start = performance.now()
    let scannedEntries = 0; let scannedBytes = 0; let truncated = false
    const matches: SearchItem[] = []
    const query = request.query.toLocaleLowerCase('en-US')
    const signature = sha256(canonical({ workspace: workspace.id, query: request.query, mode: request.mode, limit: request.limit,
      grantRevision: request.grantRevision, workspaceRevision: this.revision(workspace.id) }))
    let offset = 0
    if (request.cursor) {
      try {
        const [payload, signaturePart] = request.cursor.split('.')
        const hmac = createHmac('sha256', this.store.cursorKey).update(payload).digest('hex')
        if (hmac !== signaturePart) throw new Error()
        const cursor = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
        if (cursor.signature !== signature || cursor.expires < Date.now() || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) throw new Error()
        offset = cursor.offset
      } catch { throw new PersonalError('CURSOR_INVALID', 409) }
    }
    const visit = (path: string, depth: number): void => {
      if (scannedEntries >= limits.maxEntries || performance.now() - start > limits.maxScanMs) { truncated = true; return }
      const directory = anchorDirectory(workspace.binding, path)
      try {
      const entries = posix().entries(directory.fd, limits.maxEntries - scannedEntries)
      if (entries.hasMore) truncated = true
      directory.assertCurrent()
      for (const name of entries.names) {
        if (scannedEntries >= limits.maxEntries || performance.now() - start > limits.maxScanMs) { truncated = true; return }
        scannedEntries++
        const childPath = path ? `${path}/${name}` : name
        try { validatePath(childPath) } catch { continue }
        let stat
        try { stat = posix().statAt(directory.fd, name) } catch { continue }
        if (stat.symlink) continue
        if (stat.directory) {
          if (depth >= limits.maxDepth) { truncated = true; continue }
          directory.assertCurrent()
          visit(childPath, depth + 1)
        } else if (stat.file) {
          try {
            if (stat.size > limits.maxFileBytes) { truncated = true; continue }
            if (scannedBytes + stat.size > limits.maxScanBytes) { truncated = true; return }
            scannedBytes += stat.size
            const file = readRegular(workspace.binding, childPath)
            const filename = request.mode !== 'content' && name.toLocaleLowerCase('en-US').includes(query)
            const content = request.mode !== 'filename' && file.text.toLocaleLowerCase('en-US').includes(query)
            if (filename || content) matches.push({ path: childPath, size: file.bytes.length, sha256: file.hash, match: filename && content ? 'both' : filename ? 'filename' : 'content' })
          } catch (error) {
            if (!(error instanceof PersonalError) || !['SENSITIVE_FILE', 'UNSUPPORTED_FILE', 'UNSAFE_PATH', 'NOT_FOUND', 'LIMIT_EXCEEDED', 'FILE_CHANGED'].includes(error.code)) throw error
          }
        }
      }
      } finally { directory.close() }
    }
    visit('', 0)
    matches.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    const items = matches.slice(offset, offset + request.limit)
    const hasMore = offset + items.length < matches.length
    const payload = Buffer.from(JSON.stringify({ signature, offset: offset + items.length, expires: Date.now() + limits.cursorTtlMs })).toString('base64url')
    const nextCursor = hasMore ? `${payload}.${createHmac('sha256', this.store.cursorKey).update(payload).digest('hex')}` : null
    return { items, hasMore, nextCursor, truncated, scannedEntries, scannedBytes, workspaceRevision: this.revision(workspace.id) }
  }
}
