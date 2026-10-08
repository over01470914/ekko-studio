import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The module owns its wire schema and operation descriptions; host only invokes this hook.
export function extendServiceCenterOpenApi(openapi) {
  const schemaPath = fileURLToPath(new URL('./manifest.schema.json', import.meta.url))
  const manifestSchema = JSON.parse(readFileSync(schemaPath, 'utf8'))
  const { $schema: _dialect, $id: _schemaId, $defs: _definitions, ...rawManifest } = manifestSchema
  const manifest = JSON.parse(JSON.stringify(rawManifest).replaceAll('#/$defs/', '#/components/schemas/ServiceCenter'))
  manifest.properties.schemaVersion = { type: 'integer', enum: [2] }
  for (const [key, value] of Object.entries(manifestSchema.$defs)) {
    openapi.components.schemas[`ServiceCenter${key}`] = JSON.parse(JSON.stringify(value).replaceAll('#/$defs/', '#/components/schemas/ServiceCenter'))
  }
  openapi.components.schemas.ServiceCenterManifest = manifest
  openapi.components.schemas.ServiceCenterService = manifest.properties.services.items
  openapi.components.schemas.ServiceCenterLegacyManifest = {
    type: 'object', additionalProperties: false, required: ['schemaVersion', 'services'],
    properties: { schemaVersion: { type: 'integer', enum: [1] }, services: { type: 'array', maxItems: 200,
      items: { type: 'object', additionalProperties: false,
        required: ['id', 'name', 'description', 'url', 'icon', 'category', 'tags', 'network', 'enabled', 'sortOrder'],
        properties: { id: manifest.properties.services.items.properties.id, name: manifest.properties.services.items.properties.name,
          description: manifest.properties.services.items.properties.description, icon: manifest.properties.services.items.properties.icon,
          tags: manifest.properties.services.items.properties.tags, enabled: manifest.properties.services.items.properties.enabled,
          sortOrder: manifest.properties.services.items.properties.sortOrder, healthUrl: manifest.properties.services.items.properties.healthUrl,
          healthCheckEnabled: manifest.properties.services.items.properties.healthCheckEnabled,
          category: { type: 'string', minLength: 1, maxLength: 80 }, url: manifestSchema.$defs.endpoint.properties.url,
          network: manifestSchema.$defs.endpoint.properties.network } } } },
  }
  const ref = name => ({ $ref: `#/components/schemas/${name}` })
  const body = schema => ({ required: true, content: { 'application/json': { schema } } })
  const response = (description, schema) => ({ description, content: { 'application/json': { schema } } })
  const revision = { type: 'integer', minimum: 0 }
  const capabilities = { type: 'object', additionalProperties: false, required: ['canManageServices', 'canManageEditors'],
    properties: { canManageServices: { type: 'boolean' }, canManageEditors: { type: 'boolean' } } }
  const health = { type: 'object', required: ['state', 'checkedAt', 'latencyMs', 'status'], properties: {
    state: { type: 'string', enum: ['untested', 'stale', 'unapproved', 'disabled', 'healthy', 'http_error', 'redirected', 'timeout', 'unreachable', 'blocked', 'busy'] },
    checkedAt: { type: 'string', format: 'date-time', nullable: true }, latencyMs: { type: 'integer', nullable: true }, status: { type: 'integer', nullable: true },
  } }
  const paths = {
    '/catalog': { get: ['listServiceCenterCatalog', 'Active authenticated user; readers see only enabled services and their own favorites.', null,
      response('Catalog snapshot and server-owned module capabilities', { type: 'object', required: ['schemaVersion', 'revision', 'categories', 'nodes', 'services', 'favorites', 'health', 'capabilities'], properties: {
        schemaVersion: { type: 'integer', enum: [2] }, revision,
        categories: manifest.properties.categories, nodes: manifest.properties.nodes,
        services: { type: 'array', items: ref('ServiceCenterService') }, favorites: { type: 'array', items: { type: 'string' } },
        health: { type: 'object', additionalProperties: health }, capabilities,
      } })] },
    '/manifest': { get: ['exportServiceCenterManifest', 'Readers export enabled services only; editor grants, favorites and runtime health are excluded.', null, response('Manifest v2', ref('ServiceCenterManifest'))] },
    '/services': { put: ['saveServiceCenterService', 'Module editor only; upsert a service against the expected catalog revision.',
      body({ type: 'object', additionalProperties: false, required: ['expectedRevision', 'service'], properties: { expectedRevision: revision, service: ref('ServiceCenterService') } })] },
    '/services/{id}': { delete: ['deleteServiceCenterService', 'Module editor only; delete by stable service ID and expected revision.',
      body({ type: 'object', additionalProperties: false, required: ['expectedRevision'], properties: { expectedRevision: revision } })] },
    '/categories': { put: ['saveServiceCenterCategory', 'Module editor only; upsert category by stable ID and expected revision.',
      body({ type: 'object', additionalProperties: false, required: ['expectedRevision', 'category'], properties: { expectedRevision: revision, category: ref('ServiceCentercategory') } })] },
    '/categories/{id}': { delete: ['deleteServiceCenterCategory', 'Module editor only; explicitly reassign references to another category or null atomically.',
      body({ type: 'object', additionalProperties: false, required: ['expectedRevision', 'reassignTo'], properties: { expectedRevision: revision, reassignTo: { type: 'string', nullable: true } } })] },
    '/nodes': { put: ['saveServiceCenterNode', 'Module editor only; upsert deployment node by stable ID and expected revision.',
      body({ type: 'object', additionalProperties: false, required: ['expectedRevision', 'node'], properties: { expectedRevision: revision, node: ref('ServiceCenternode') } })] },
    '/nodes/{id}': { delete: ['deleteServiceCenterNode', 'Module editor only; explicitly reassign references to another node or null atomically.',
      body({ type: 'object', additionalProperties: false, required: ['expectedRevision', 'reassignTo'], properties: { expectedRevision: revision, reassignTo: { type: 'string', nullable: true } } })] },
    '/import/preview': { post: ['previewServiceCenterImport', 'Module editor only; validate full manifest without persisting or granting health approval.',
      body({ type: 'object', additionalProperties: false, required: ['manifest'], properties: { manifest: { oneOf: [ref('ServiceCenterManifest'), ref('ServiceCenterLegacyManifest')] } } })] },
    '/import/confirm': { post: ['confirmServiceCenterImport', 'Module editor only; merge/upsert. Every conflict requires keep or overwrite. Never deletes unmentioned services.',
      body({ type: 'object', additionalProperties: false, required: ['expectedRevision', 'manifest', 'conflicts'], properties: {
        expectedRevision: revision, manifest: { oneOf: [ref('ServiceCenterManifest'), ref('ServiceCenterLegacyManifest')] }, conflicts: { type: 'object', additionalProperties: { type: 'string', enum: ['keep', 'overwrite'] }, description: 'Entity-scoped keys: categories:id, nodes:id, services:id' },
      } })] },
    '/favorites/{id}': { put: ['setServiceCenterFavorite', 'Active authenticated user; ID must name an enabled service and favorite belongs only to the caller.',
      body({ type: 'object', additionalProperties: false, required: ['favorite'], properties: { favorite: { type: 'boolean' } } })] },
    '/health/{id}': { post: ['checkServiceCenterHealth', 'ID-only approved bounded server-side GET; does not prove the browser can open the service.', null, response('Backend probe or explicit unapproved/disabled state', health)] },
    '/health/{id}/approval': { put: ['approveServiceCenterHealth', 'Module editor only; explicit approval pinned to the registered health URL.',
      body({ type: 'object', additionalProperties: false, required: ['approved'], properties: { approved: { type: 'boolean' } } })] },
    '/editors': { get: ['listServiceCenterEditors', 'Super administrator only; editor grants are separate from the public manifest.'] },
    '/editors/{id}': { put: ['changeServiceCenterEditor', 'Super administrator only; target must be an active admin; audit grant and revoke.',
      body({ type: 'object', additionalProperties: false, required: ['granted'], properties: { granted: { type: 'boolean' } } })] },
  }
  for (const [suffix, methods] of Object.entries(paths)) {
    const path = `/api/studio/service-center${suffix}`
    if (!openapi.paths[path]) throw new Error(`Service Center route missing from generated OpenAPI: ${path}`)
    for (const [method, [operationId, description, requestBody, content]] of Object.entries(methods)) {
      const operation = openapi.paths[path][method]
      if (!operation) throw new Error(`Service Center method missing: ${method} ${path}`)
      operation.operationId = operationId
      operation.description = description
      if (requestBody) operation.requestBody = requestBody
      else delete operation.requestBody
      if (content) operation.responses['200'] = content
      operation.responses['403'] = { description: 'Module permission or active account required' }
      if (['put', 'post', 'delete'].includes(method) && !suffix.startsWith('/favorites') && !suffix.startsWith('/health')) operation.responses['409'] = { description: 'Expected catalog revision mismatch or health target changed' }
    }
  }
}

export const studioExtensionOpenApi = {
  id: 'service-center',
  tag: { name: 'Service Center', description: 'Studio service directory, personal favorites, health and local editor grants' },
  extend: extendServiceCenterOpenApi,
}
