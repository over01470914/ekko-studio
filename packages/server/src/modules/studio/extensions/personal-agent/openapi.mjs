import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The module owns its wire schema; the host only invokes this hook after scanning its routes.
export function extendPersonalAgentOpenApi(openapi) {
  const schemaPath = fileURLToPath(new URL('../../../../../../personal-assistant/protocol.schema.json', import.meta.url))
  const protocol = JSON.parse(readFileSync(schemaPath, 'utf8'))
  const embed = value => JSON.parse(JSON.stringify(value).replaceAll('#/$defs/', '#/components/schemas/Personal'))
  const copy = name => embed(protocol.$defs[name])
  const component = (name, def) => { openapi.components.schemas[name] = embed(def) }
  // Every canonical definition in the single source-of-truth schema is exported as a named component.
  for (const [name, definition] of Object.entries(protocol.$defs)) component(`Personal${name}`, definition)
  const ref = name => ({ $ref: `#/components/schemas/Personal${name}` })

  component('PersonalError', protocol.$defs.Error)
  component('PersonalOwnerState', copy('OwnerState'))
  const body = schema => ({ required: true, content: { 'application/json': { schema } } })
  const response = (description, schema) => ({ description, content: { 'application/json': { schema } } })
  const paths = {
    '/state': { get: ['getPersonalAgentState', 'Active verified Studio account; honest registered state only. Unconfigured or unreachable peers report unavailable instead of synthetic data.',
      null, response('Owner-scoped registered workspaces, grants and peer availability',
        { $ref: '#/components/schemas/PersonalOwnerState' })] },
    '/operations': { post: ['executePersonalAgentOperation', 'Active verified Studio account; bounded search/read/write/delete/status against one exact approved target. Payload hash and operationId are durable receipts.',
      body({ $ref: '#/components/schemas/PersonalRequest' }), response('Bounded, schema-validated result or an explicit unknown-state receipt',
        { oneOf: [{ $ref: '#/components/schemas/PersonalResponse' }, { $ref: '#/components/schemas/PersonalError' }] })] },
    '/grants/{id}': { put: ['updatePersonalAgentGrant', 'Active verified reachable account owner; explicit owner-scoped capability revision. Revocation is enforced on every request including an open connection.',
      { required: true, content: { 'application/json': { schema: ref('GrantUpdate') } } }, response('New grant revision or a conflict when the expected revision is stale', ref('GrantResult'))] },
    '/delete-confirmations': { post: ['confirmPersonalAgentDelete', 'Active verified Studio account only. The receiver owner mints a target/path/operation-bound confirmation; a sender or MCP tool cannot mint its own.',
      body({ $ref: '#/components/schemas/PersonalConfirmationRequest' }), response('Single-use, expiring confirmation bound to the exact file hash and payload', ref('ConfirmationResult'))] },
    '/restore': { post: ['restorePersonalAgentDelete', 'Active verified Studio account owner only; restores one receipted soft delete to containment-checked private trash.',
      body({ $ref: '#/components/schemas/PersonalRestoreRequest' }), response('Full target-bound restore envelope, readback hash or explicit unknown state', { $ref: '#/components/schemas/PersonalResponse' })] },
  }
  for (const [suffix, methods] of Object.entries(paths)) {
    const path = `/api/studio/personal-agent${suffix}`
    if (!openapi.paths[path]) throw new Error(`Personal Agent route missing from generated OpenAPI: ${path}`)
    for (const [method, [operationId, description, requestBody, content]] of Object.entries(methods)) {
      const operation = openapi.paths[path][method]
      if (!operation) throw new Error(`Personal Agent method missing: ${method} ${path}`)
      operation.operationId = operationId
      operation.description = description
      if (requestBody) operation.requestBody = requestBody
      else delete operation.requestBody
      operation.responses['200'] = content
      operation.responses['403'] = { description: 'Active verified account or exact grant/capability required' }
      operation.responses['404'] = { description: 'Unknown device/workspace/target (fail closed)' }
      if (['put', 'post'].includes(method)) operation.responses['409'] = { description: 'Expected revision/receipt conflict or unknown mutation state' }
    }
  }
}

export const studioExtensionOpenApi = {
  id: 'personal-agent',
  tag: { name: 'Personal Agent', description: 'Receiver-owned bounded workspace file operations, explicit grants and durable operation receipts' },
  extend: extendPersonalAgentOpenApi,
}