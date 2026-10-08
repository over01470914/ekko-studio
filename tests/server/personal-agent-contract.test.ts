import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PersonalReceiver, protocolSchema, matchesSchema, parseRequest, validateResponse } from '../../packages/personal-assistant/src'
import { allowedChangedPath, moduleImportViolations } from '../../scripts/check-studio-extension-boundary.mjs'

describe('Personal protocol and architecture contract', () => {
  it('rejects wrong result shape for the declared operation', () => {
    expect(() => validateResponse({ version: 1, operationId: 'operation-123456789', target: { deviceId: 'device', hostname: 'host', workspaceId: 'workspace' },
      outcome: 'completed', action: 'read', data: { state: 'completed' } })).toThrow('INVALID_RESPONSE')
  })
  it('is the same checked-in schema used by request validation, with exact request bounds', () => {
    expect(protocolSchema).toEqual(JSON.parse(readFileSync('packages/personal-assistant/protocol.schema.json', 'utf8')))
    expect(protocolSchema['x-engine-version']).toBe('0.1.0')
    expect(() => parseRequest({ version: 1, action: 'write', operationId: 'operation-123456789', deviceId: 'device', workspaceId: 'workspace',
      grantRevision: 1, path: 'file.txt', mode: 'overwrite', content: 'x' })).toThrow('INVALID_REQUEST')
    const accessor = Object.defineProperty({}, 'action', { enumerable: true, get() { throw new Error('getter must never run') } })
    expect(() => parseRequest(accessor)).toThrow('INVALID_REQUEST')
  })
  it('allows only the approved Personal seams and forbids pure-engine imports into Studio', () => {
    expect(allowedChangedPath('packages/personal-assistant/src/receiver.ts')).toBe(true)
    expect(allowedChangedPath('packages/server/src/modules/studio/extensions/personal-agent/service.ts')).toBe(true)
    expect(allowedChangedPath('packages/server/src/modules/studio/services/auth.ts')).toBe(false)
    expect(moduleImportViolations('packages/server/src/modules/studio/extensions/personal-agent/service.ts', "import '../service-center/storage'\nimport '../../public/config'\n")).toHaveLength(2)
    expect(moduleImportViolations('packages/personal-assistant/src/receiver.ts', "import '../../server/src/modules/studio/public/config'\n")).toHaveLength(1)
    expect(moduleImportViolations('packages/server/src/modules/studio/extensions/personal-agent/service.ts', "import { PersonalReceiver } from '../../../../../../personal-assistant/src'\n")).toEqual([])
  })
})
