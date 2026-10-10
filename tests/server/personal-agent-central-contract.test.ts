import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { allowedChangedPath, moduleImportViolations } from '../../scripts/check-studio-extension-boundary.mjs'
import { matchesSchema } from '../../packages/personal-assistant/src'
const schema = JSON.parse(readFileSync('packages/server/src/modules/studio/extensions/personal-agent/central.schema.json', 'utf8'))
describe('personal gateway v1 projection and exact approved boundaries', () => {
  it('exports all 10 module endpoints with authenticated canonical central projections', () => {
    const doc = JSON.parse(readFileSync('docs/openapi.json', 'utf8'))
    const paths = Object.entries(doc.paths).filter(([path]) => path.startsWith('/api/studio/personal-agent/'))
    expect(paths).toHaveLength(10)
    for (const [name, def] of Object.entries(schema.$defs)) expect(doc.components.schemas['PersonalCentral' + name]).toEqual(JSON.parse(JSON.stringify(def).replaceAll('#/$defs/', '#/components/schemas/PersonalCentral')))
    for (const [, methods] of paths) for (const operation of Object.values(methods as any) as any[]) { expect(operation.operationId).toBeTruthy(); expect(operation.security).toEqual([{ BearerAuth: [] }]) }
    expect(doc.paths['/api/studio/personal-agent/central/events'].get.responses[200].content['text/event-stream'].schema).toEqual({ $ref: '#/components/schemas/PersonalCentralEvent' })
  })
  it('validates empty state and disallows private central/root/auth fields in projection', () => {
    expect(matchesSchema({ version: 1, configured: false, connected: false }, schema.$defs.State, schema)).toBe(true)
    expect(matchesSchema({ version: 1, configured: false, connected: false, token: 'fixture' }, schema.$defs.State, schema)).toBe(false)
    expect(matchesSchema({ session: { id: 'fixture', profile: 'naya', title: '', messages: [], workspace: '/private/root' } }, schema.$defs.History, schema)).toBe(false)
  })
  it('permits new exact native/bootstrap/test seams without opening unrelated core or renderer Node imports', () => {
    for (const path of ['packages/client/src/modules/studio-extensions/personal-agent/PersonalAgentView.vue', 'packages/server/src/bootstrap/personal-gateway.ts', 'packages/desktop/src/main/personal-entry.ts', 'packages/client/src/bootstrap/extension-events.ts', 'tests/e2e/personal-agent-native.spec.ts']) expect(allowedChangedPath(path)).toBe(true)
    for (const path of ['packages/desktop/src/main/index.ts', 'packages/server/src/bootstrap/http.ts', 'packages/client/src/router/index.ts', 'packages/server/src/modules/studio/services/auth.ts']) expect(allowedChangedPath(path)).toBe(false)
    const path = 'packages/client/src/modules/studio-extensions/personal-agent/controller.ts'
    expect(moduleImportViolations(path, "import '../../../../../../personal-assistant/src'\nimport 'node:fs'\n")).toHaveLength(2)
    expect(moduleImportViolations(path, "import './contract'\nimport type { ClientExtensionHost } from '../registry'\n")).toEqual([])
  })
})
