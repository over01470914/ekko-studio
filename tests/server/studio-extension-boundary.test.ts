import { describe, expect, it } from 'vitest'
import { allowedChangedPath, moduleImportViolations } from '../../scripts/check-studio-extension-boundary.mjs'

const client = 'packages/client/src/modules/studio-extensions/service-center/store.ts'
const server = 'packages/server/src/modules/studio/extensions/service-center/catalog.ts'

describe('Service Center source boundary', () => {
  it('allows only module-owned files, named host seams and tests', () => {
    expect(allowedChangedPath(client)).toBe(true)
    expect(allowedChangedPath('packages/client/src/main.ts')).toBe(true)
    expect(allowedChangedPath('tests/server/studio-extension-openapi.test.ts')).toBe(true)
    expect(allowedChangedPath('packages/client/src/router/index.ts')).toBe(false)
    expect(allowedChangedPath('packages/server/src/modules/studio/public/safe-file-store.ts')).toBe(false)
  })
  it('rejects business imports into host auth, configuration or tokens', () => {
    expect(moduleImportViolations(client, "import { getToken } from '@/api/client'\nimport '../private-auth'\n")).toHaveLength(2)
    expect(moduleImportViolations(server, "import { config } from '../../public/config'\n")).toHaveLength(1)
    expect(moduleImportViolations(client, "import { host } from './host'\nimport type { Spec } from '../registry'\n")).toEqual([])
  })
})
