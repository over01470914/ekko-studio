import { computed, ref } from 'vue'
import type { ClientExtensionHost } from '../registry'
import type { Capability, FileRequest, FileResponse, SearchItem } from './contract'

export interface Workspace { id: string; deviceId: string; hostname: string; label: string; capabilities: Capability[]; grantRevision: number }
interface OwnerState { configured: boolean; workspaces: Workspace[]; peers: Array<{ deviceId: string; workspaceId: string; available: boolean; error?: string }>; grants?: Array<{ id: string; workspaceId: string; grantRevision: number; capabilities: Capability[] }> }
export type DeleteIntent = Omit<Extract<FileRequest, { action: 'delete' }>, 'confirmationId'>
export interface PersonalClientHost extends ClientExtensionHost {
  chooseWorkspace?(label: string, capabilities: Capability[]): Promise<unknown>
  openWorkbench?(): void | Promise<void>
  stream?(path: string, listener: (event: any) => void, after: number): () => void
}
const base = '/api/studio/personal-agent'
const errorCode = (error: unknown) => error instanceof Error ? error.message : 'IO_FAILURE'
export function createPersonalAgentController(host: PersonalClientHost) {
  const state = ref<OwnerState>({ configured: false, workspaces: [], peers: [] })
  const selected = ref(''); const busy = ref(false); const error = ref('')
  const items = ref<SearchItem[]>([]); const cursor = ref<string | null>(null)
  const file = ref<{ path: string; text: string; sha256: string; truncated: boolean } | null>(null)
  const result = ref<FileResponse | null>(null); const pendingOperation = ref<FileRequest | null>(null)
  const receipt = ref<string | null>(null); const central = ref<any>({ configured: false, connected: false })
  const messages = ref<Array<{ role: string; content: string }>>([]); const runState = ref(''); const draft = ref('')
  let stopStream: (() => void) | null = null; let sequence = 0; let epoch = 0
  let receiptTarget: { deviceId: string; workspaceId: string } | null = null
  const rawRequest = host.request
  host = { ...host, request: async <T>(path: string, options?: RequestInit): Promise<T> => {
    const current = epoch; const value = await rawRequest<T>(path, options)
    if (epoch !== current) throw new Error('AUTH_INVALIDATED')
    return value
  } }
  const targets = computed(() => state.value.workspaces)
  const target = computed(() => targets.value.find(w => `${w.deviceId}/${w.id}` === selected.value))
  function select(key: string) { if (busy.value) return; selected.value = key; file.value = null; items.value = []; cursor.value = null; result.value = null; error.value = '' }
  async function guard(action: () => Promise<void>) {
    if (busy.value) return
    const current = epoch; busy.value = true; error.value = ''
    try { await action() } catch (e) { if (epoch === current) error.value = errorCode(e) } finally { busy.value = false }
  }
  async function refresh() { await guard(async () => { state.value = await host.request<OwnerState>(`${base}/state`) }) }
  function bind(action: FileRequest['action']): any {
    const t = target.value
    if (!t) throw new Error('TARGET_REQUIRED')
    return { version: 1, operationId: crypto.randomUUID(), action, deviceId: t.deviceId, workspaceId: t.id, grantRevision: t.grantRevision }
  }
  function assertTarget(response: { target?: { deviceId: string; workspaceId: string } }, request: { deviceId: string; workspaceId: string }) {
    if (response.target?.deviceId !== request.deviceId || response.target?.workspaceId !== request.workspaceId) throw new Error('TARGET_MISMATCH')
  }
  async function execute(request: FileRequest) {
    pendingOperation.value = request
    const value = await host.request<FileResponse>(`${base}/operations`, { method: 'POST', body: JSON.stringify(request) })
    assertTarget(value, request)
    if (value.operationId !== request.operationId || value.action !== request.action) throw new Error('INVALID_RESPONSE')
    result.value = value
    if (value.outcome !== 'completed') throw new Error(value.outcome.toUpperCase())
    pendingOperation.value = null
    return value
  }
  async function search(query: string, more = false) { await guard(async () => {
    const value = await execute({ ...bind('search'), query, mode: 'both', limit: 20, ...(more && cursor.value ? { cursor: cursor.value } : {}) })
    if ('items' in value.data) { items.value = more ? [...items.value, ...value.data.items] : value.data.items; cursor.value = value.data.nextCursor }
  }) }
  async function read(path: string) { file.value = null; await guard(async () => {
    const value = await execute({ ...bind('read'), path })
    if ('text' in value.data) file.value = { path, text: value.data.text, sha256: value.data.sha256, truncated: value.data.truncated }
  }) }
  async function write(path: string, text: string, action: 'create' | 'overwrite') { await guard(async () => {
    if (action === 'overwrite' && (file.value?.path !== path || file.value.truncated)) throw new Error('READ_REQUIRED')
    const request = { ...bind('write'), path, mode: action, content: text, ...(action === 'overwrite' ? { expectedSha256: file.value!.sha256 } : {}) }
    const value = await execute(request)
    if ('sha256' in value.data) file.value = { path, text, sha256: value.data.sha256, truncated: false }
  }) }
  function prepareDelete(): DeleteIntent {
    if (!file.value) throw new Error('READ_REQUIRED')
    return { ...bind('delete'), path: file.value.path, expectedSha256: file.value.sha256 }
  }
  async function confirmDelete(request: DeleteIntent) { await guard(async () => {
    const confirmation = await host.request<{ confirmationId: string; target: { deviceId: string; workspaceId: string }; path: string; sha256: string }>(`${base}/delete-confirmations`, { method: 'POST', body: JSON.stringify({ sourceDeviceId: request.deviceId, request }) })
    assertTarget(confirmation, request)
    if (confirmation.path !== request.path || confirmation.sha256 !== request.expectedSha256) throw new Error('TARGET_MISMATCH')
    const value = await execute({ ...request, confirmationId: confirmation.confirmationId })
    if ('receiptId' in value.data) { receipt.value = value.data.receiptId; receiptTarget = { deviceId: request.deviceId, workspaceId: request.workspaceId }; file.value = null }
  }) }
  async function restore() { await guard(async () => {
    if (!receipt.value) throw new Error('RECEIPT_REQUIRED')
    const value = await host.request<FileResponse>(`${base}/restore`, { method: 'POST', body: JSON.stringify({ receiptId: receipt.value }) })
    if (!receiptTarget) throw new Error('TARGET_MISMATCH')
    assertTarget(value, receiptTarget)
    result.value = value
    if (value.outcome !== 'completed') throw new Error('UNKNOWN')
    receipt.value = null; receiptTarget = null
  }) }
  async function revoke(id: string, revision: number) { await guard(async () => {
    await host.request(`${base}/grants/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ expectedRevision: revision, capabilities: [] }) })
    state.value = await host.request<OwnerState>(`${base}/state`)
  }) }
  async function status() { if (!pendingOperation.value) return; const old = pendingOperation.value; await guard(async () => {
    const value = await host.request<FileResponse>(`${base}/operations`, { method: 'POST', body: JSON.stringify({ version: 1, action: 'status', operationId: old.operationId, deviceId: old.deviceId, workspaceId: old.workspaceId, grantRevision: old.grantRevision }) })
    assertTarget(value, old); result.value = value
  }) }
  function observe() {
    stopStream?.()
    stopStream = host.stream?.(`${base}/central/events`, event => {
      if (event.event === 'connection.failed' && event.sessionId === undefined) { runState.value = 'connection.failed'; error.value = 'CENTRAL_UNAVAILABLE'; return }
      if (event.sessionId !== central.value.sessionId || !Number.isSafeInteger(event.sequence) || event.sequence <= sequence) return
      sequence = event.sequence; runState.value = event.event
      if (event.event === 'connection.failed' || event.event === 'run.failed') error.value = 'CENTRAL_UNAVAILABLE'
      if (event.event === 'message.delta') draft.value += typeof event.data?.delta === 'string' ? event.data.delta : ''
      if (event.event === 'run.completed') { if (draft.value) messages.value.push({ role: 'assistant', content: draft.value }); draft.value = '' }
    }, sequence) || null
  }
  async function refreshCentral() { const current = epoch; try {
    central.value = await host.request(`${base}/central/state`)
    if (epoch !== current) return
    if (central.value.connected) { const history = await host.request<any>(`${base}/central/history`); messages.value = history.session.messages; observe() }
  } catch (e) { if (epoch === current) { error.value = errorCode(e); central.value = { configured: true, connected: false } } } }
  async function connect(input: Record<string, string>) { await guard(async () => { stopStream?.(); sequence = 0; draft.value = ''; central.value = await host.request(`${base}/central/connection`, { method: 'POST', body: JSON.stringify(input) }); await refreshCentral() }) }
  async function send(input: string) { await guard(async () => { const response = await host.request<any>(`${base}/central/run`, { method: 'POST', body: JSON.stringify({ input }) }); if (!response.accepted || response.sessionId !== central.value.sessionId) throw new Error('CENTRAL_IDENTITY'); messages.value.push({ role: 'user', content: input }); runState.value = 'submitted' }) }
  function dispose() { epoch++; stopStream?.(); stopStream = null; file.value = null; messages.value = []; draft.value = ''; central.value = { configured: false, connected: false }; selected.value = ''; items.value = []; result.value = null; pendingOperation.value = null; receipt.value = null; receiptTarget = null; error.value = ''; state.value = { configured: false, workspaces: [], peers: [] } }
  return { state, targets, target, selected, busy, error, items, cursor, file, result, pendingOperation, receipt, central, messages, runState, draft, refresh, select, read, search, write, prepareDelete, confirmDelete, restore, revoke, status, refreshCentral, connect, send, dispose }
}
