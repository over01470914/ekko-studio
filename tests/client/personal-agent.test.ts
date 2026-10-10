// @vitest-environment jsdom
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { ref } from 'vue'
import { createPersonalAgentController } from '../../packages/client/src/modules/studio-extensions/personal-agent/controller'
import type { FileRequest as CanonicalRequest, FileResponse as CanonicalResponse } from '../../packages/personal-assistant/src'
import type { FileRequest, FileResponse } from '../../packages/client/src/modules/studio-extensions/personal-agent/contract'

const workspace = { id: 'workspace', deviceId: 'device', hostname: 'Same host', label: 'Folder', capabilities: ['search', 'read', 'write', 'delete'], grantRevision: 1 }
function fixture() {
  const request = vi.fn(async (path: string, options?: RequestInit): Promise<any> => {
    if (path.endsWith('/state')) return { version: 1, configured: true, workspaces: [workspace], grants: [], peers: [] }
    const input = JSON.parse(options?.body as string)
    return { version: 1, operationId: input.operationId, action: input.action, outcome: 'completed', target: { deviceId: input.deviceId, workspaceId: input.workspaceId, hostname: workspace.hostname },
      data: input.action === 'read' ? { text: 'real API response fixture', path: input.path, sha256: 'a'.repeat(64), truncated: false } : { items: [], hasMore: false, nextCursor: null } }
  })
  const host = { request, locale: ref('en'), theme: ref('light'), managedUsers: async () => ({ users: [] }), hasSession: () => true, onAuthInvalidated: () => () => {} }
  return { request, controller: createPersonalAgentController(host) }
}
describe('personal file UI authority', () => {
  it('keeps renderer DTO types identical to the accepted PA01 public contract', () => {
    expectTypeOf<FileRequest>().toEqualTypeOf<CanonicalRequest>()
    expectTypeOf<FileResponse>().toEqualTypeOf<CanonicalResponse>()
  })
  it('binds each action to the picked identity rather than hostname/path and uses only module-local APIs', async () => {
    const { request, controller } = fixture(); await controller.refresh()
    controller.select('device/workspace'); await controller.read('same.txt')
    expect(controller.file.value?.text).toBe('real API response fixture')
    const body = JSON.parse(request.mock.calls[1][1]!.body as string)
    expect(body).toMatchObject({ action: 'read', deviceId: 'device', workspaceId: 'workspace', grantRevision: 1, path: 'same.txt' })
    expect(request.mock.calls.every(([path]) => path.startsWith('/api/studio/personal-agent/'))).toBe(true)
  })
  it('rejects mismatched target readback and never silently retries a mutation', async () => {
    const { request, controller } = fixture(); await controller.refresh(); controller.select('device/workspace')
    request.mockResolvedValueOnce({ version: 1, target: { deviceId: 'other', workspaceId: 'workspace' }, action: 'read', outcome: 'completed', data: { text: 'wrong bytes' } })
    await controller.read('same.txt'); expect(controller.file.value).toBeNull(); expect(controller.error.value).toBe('TARGET_MISMATCH')
    request.mockRejectedValueOnce(new Error('TRANSPORT_UNKNOWN')); await controller.write('new.txt', 'bytes', 'create')
    const operations = request.mock.calls.filter(([path]) => path.endsWith('/operations'))
    expect(operations).toHaveLength(2); expect(controller.error.value).toBe('TRANSPORT_UNKNOWN')
    expect(controller.pendingOperation.value).toMatchObject({ deviceId: 'device', workspaceId: 'workspace' })
  })
  it('keeps delete target/hash/operation fixed across the confirmation step', async () => {
    const { request, controller } = fixture(); await controller.refresh(); controller.select('device/workspace'); await controller.read('same.txt')
    const deletion = controller.prepareDelete()
    expect(deletion).toMatchObject({ path: 'same.txt', expectedSha256: 'a'.repeat(64), deviceId: 'device', workspaceId: 'workspace' })
    request.mockResolvedValueOnce({ confirmationId: 'confirmation', target: { deviceId: 'device', workspaceId: 'workspace', hostname: workspace.hostname }, path: 'same.txt', sha256: 'a'.repeat(64) })
    request.mockResolvedValueOnce({ version: 1, operationId: deletion.operationId, target: { deviceId: 'device', workspaceId: 'workspace', hostname: workspace.hostname }, action: 'delete', outcome: 'completed', data: { receiptId: 'receipt' } })
    await controller.confirmDelete(deletion)
    const input = JSON.parse(request.mock.calls.find(([path]) => path.endsWith('/delete-confirmations'))![1]!.body as string)
    expect(input.request).toEqual(deletion)
    const applying = JSON.parse(request.mock.calls.filter(([path]) => path.endsWith('/operations')).at(-1)![1]!.body as string)
    expect(applying).toEqual({ ...deletion, confirmationId: 'confirmation' })
  })
  it('does not revive a disposed account from late workspace/central responses', async () => {
    const { request, controller } = fixture()
    let resolve: (value: any) => void = () => {}
    request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = controller.refresh(); controller.dispose()
    resolve({ configured: true, workspaces: [workspace], peers: [] }); await pending
    expect(controller.state.value.workspaces).toEqual([])
    request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const centralPending = controller.refreshCentral(); controller.dispose()
    resolve({ connected: true, sessionId: 'foreign-account' }); await centralPending
    expect(controller.central.value.connected).toBe(false)
    expect(request.mock.calls.some(([path]) => path.endsWith('/central/history'))).toBe(false)
  })
  it('shows observer transport failure without submitting/replaying or cancelling a run', async () => {
    let receive: (event: any) => void = () => {}; const stop = vi.fn()
    const request = vi.fn(async (path: string): Promise<any> => path.endsWith('/state') ? { configured: true, connected: true, sessionId: 'fixture' } : { session: { messages: [] } })
    const c = createPersonalAgentController({ request, locale: ref('en'), theme: ref('light'), managedUsers: async () => ({ users: [] }), hasSession: () => true, onAuthInvalidated: () => () => {}, stream: (_path, listener) => { receive = listener; return stop } })
    await c.refreshCentral(); receive({ event: 'connection.failed', data: { code: 'CENTRAL_UNAVAILABLE' } })
    expect(c.error.value).toBe('CENTRAL_UNAVAILABLE'); c.dispose(); expect(stop).toHaveBeenCalledTimes(1)
    expect(request.mock.calls.map(([path]) => path)).toEqual(['/api/studio/personal-agent/central/state', '/api/studio/personal-agent/central/history'])
  })
})
