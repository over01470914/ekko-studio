import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyStudioExtensionOpenApi, loadStudioExtensionOpenApi } from '../../scripts/studio-extension-openapi.mjs'

const contract = (extend: (doc: any) => void) => ({ id: 'service-center', tag: { name: 'Service Center' }, extend })
const document = () => ({ paths: {
  '/api/studio/auth': { get: { operationId: 'getAuth', security: [{ BearerAuth: [] }], responses: { 200: {} } } },
  '/api/studio/service-center/catalog': { get: { operationId: 'getCatalog', tags: ['Service Center'], security: [{ BearerAuth: [] }], responses: { 200: {} } } },
}, components: { schemas: { Host: { type: 'string' } } } })
const enhance = (doc: ReturnType<typeof document>) => {
  doc.components.schemas.ServiceCenterManifest = { type: 'object' }
  doc.paths['/api/studio/service-center/catalog'].get.operationId = 'listCatalog'
  doc.paths['/api/studio/service-center/catalog'].get.responses[200] = { description: 'Catalog', content: { schema: { $ref: '#/components/schemas/ServiceCenterManifest' } } }
}

const temporaryRoots: string[] = []
function temporarySource() {
  const source = mkdtempSync(join(process.cwd(), 'packages/server/src/modules/studio/extensions/.tmp-'))
  temporaryRoots.push(source)
  return source
}
afterEach(() => {
  while (temporaryRoots.length) rmSync(temporaryRoots.pop()!, { recursive: true, force: true })
})

describe('generic Studio extension OpenAPI collector', () => {
  it('discovers only the checked-in source contract and enriches its scanned route', async () => {
    const source = join(process.cwd(), 'packages/server/src')
    const found = await loadStudioExtensionOpenApi(source)
    expect(found.map(item => item.id)).toContain('service-center')
    const doc = document()
    applyStudioExtensionOpenApi(doc, contract(enhance))
    expect(doc.paths['/api/studio/auth'].get.operationId).toBe('getAuth')
    expect(doc.paths['/api/studio/service-center/catalog'].get.operationId).toBe('listCatalog')
  })
  it('loads a real contract file but refuses a symlinked or directory contract', async () => {
    const source = temporarySource()
    const real = join(source, 'modules/studio/extensions/real-contract')
    mkdirSync(real, { recursive: true })
    writeFileSync(join(real, 'openapi.mjs'), 'export const studioExtensionOpenApi = { id: "real-contract", tag: { name: "Real" }, extend: () => {} }\n')
    expect((await loadStudioExtensionOpenApi(source)).map(item => item.id)).toEqual(['real-contract'])

    const linked = join(source, 'modules/studio/extensions/linked-contract')
    mkdirSync(linked, { recursive: true })
    symlinkSync(join(real, 'openapi.mjs'), join(linked, 'openapi.mjs'))
    await expect(loadStudioExtensionOpenApi(source)).rejects.toThrow('Invalid Studio extension OpenAPI source: linked-contract')
    rmSync(linked, { recursive: true, force: true })

    const nested = join(source, 'modules/studio/extensions/nested-contract')
    mkdirSync(join(nested, 'openapi.mjs'), { recursive: true })
    expect(readdirSync(join(source, 'modules/studio/extensions')).sort()).toEqual(['nested-contract', 'real-contract'])
    await expect(loadStudioExtensionOpenApi(source)).rejects.toThrow('Invalid Studio extension OpenAPI source: nested-contract')
  })
  it('fails closed on host path, host schema, unresolved ref and invalid auth changes', () => {
    for (const mutation of [
      (doc: ReturnType<typeof document>) => { doc.paths['/api/studio/auth'].get.operationId = 'overwritten' },
      (doc: ReturnType<typeof document>) => { doc.components.schemas.Host.type = 'object' },
      (doc: ReturnType<typeof document>) => { doc.paths['/api/studio/service-center/catalog'].get.responses[200].content.schema.$ref = '#/components/schemas/Missing' },
      (doc: ReturnType<typeof document>) => { doc.paths['/api/studio/service-center/catalog'].get.security = [] },
    ]) {
      const doc = document()
      expect(() => applyStudioExtensionOpenApi(doc, contract(value => { enhance(value); mutation(value) }))).toThrow()
    }
  })
})