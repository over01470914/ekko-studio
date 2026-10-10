import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PersonalWorkspaceService } from '../../packages/server/src/modules/studio/extensions/personal-agent/workspaces'
import { sha256 } from '../../packages/personal-assistant/src'

describe('native-owned workspace onboarding', () => {
  it('onboards an explicitly selected folder and executes PA01 create/read/hash-bound delete/restore, persisting identities without exposing roots', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pa02-folder-')); const root = join(base, 'files'); mkdirSync(root)
    let service = new PersonalWorkspaceService(join(base, 'private'), 'owner', 'http://127.0.0.1:4362', 'fixture-host')
    try {
      const workspace = await service.onboard(root, 'Approved folder', ['search', 'read', 'write', 'delete'])
      const state = await service.stateFor('owner')
      expect(state.workspaces).toHaveLength(1); expect(JSON.stringify(state)).not.toContain(root)
      expect(await service.stateFor('another-owner')).toMatchObject({ workspaces: [] })
      const binding = { version: 1, operationId: randomUUID(), deviceId: workspace.deviceId, workspaceId: workspace.id, grantRevision: 1 }
      await service.execute('owner', { ...binding, action: 'write', mode: 'create', path: 'note.txt', content: 'real approved bytes' })
      expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('real approved bytes')
      const read = await service.execute('owner', { ...binding, operationId: randomUUID(), action: 'read', path: 'note.txt' })
      expect(read.data).toMatchObject({ text: 'real approved bytes', sha256: sha256('real approved bytes') })
      const deleting = { ...binding, operationId: randomUUID(), action: 'delete', path: 'note.txt', expectedSha256: sha256('real approved bytes') }
      const confirmation = service.confirmDelete('owner', workspace.deviceId, deleting)
      const deleted = await service.execute('owner', { ...deleting, confirmationId: confirmation.confirmationId })
      await service.restore('owner', (deleted.data as any).receiptId)
      expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('real approved bytes')
      service.close(); service = new PersonalWorkspaceService(join(base, 'private'), 'owner', 'http://127.0.0.1:4362', 'fixture-host')
      expect((await service.stateFor('owner')).workspaces[0]).toMatchObject({ id: workspace.id, deviceId: workspace.deviceId })
      await expect(service.onboard(root, 'Duplicate', ['read'])).rejects.toMatchObject({ code: 'WORKSPACE_OVERLAP' })
    } finally { service.close(); rmSync(base, { recursive: true, force: true }) }
  })
  it('supports independent workspaces with identical relative filenames and immediately enforces revocation', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pa02-identity-')); const service = new PersonalWorkspaceService(join(base, 'private'), 'owner', 'http://127.0.0.1:4362', 'same-host')
    try {
      const targets = []
      for (const label of ['one', 'two']) { const root = join(base, label); mkdirSync(root); targets.push(await service.onboard(root, label, ['read', 'write'])) }
      expect(targets[0].id).not.toBe(targets[1].id)
      for (const target of targets) await service.execute('owner', { version: 1, operationId: randomUUID(), deviceId: target.deviceId, workspaceId: target.id, grantRevision: 1,
        action: 'write', mode: 'create', path: 'same.txt', content: target.label })
      const state = await service.stateFor('owner'); const grant = state.grants.find(item => item.workspaceId === targets[0].id)!
      service.setGrant('owner', grant.id, 1, [])
      await expect(service.execute('owner', { version: 1, operationId: randomUUID(), deviceId: targets[0].deviceId, workspaceId: targets[0].id, grantRevision: 1,
        action: 'read', path: 'same.txt' })).rejects.toMatchObject({ code: 'GRANT_MISMATCH' })
    } finally { service.close(); rmSync(base, { recursive: true, force: true }) }
  })
})
