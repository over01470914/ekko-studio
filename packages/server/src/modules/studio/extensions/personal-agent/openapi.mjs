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
  const central = JSON.parse(readFileSync(new URL('./central.schema.json', import.meta.url), 'utf8'))
  for (const [name, definition] of Object.entries(central.$defs)) openapi.components.schemas[`PersonalCentral${name}`] = JSON.parse(JSON.stringify(definition).replaceAll('#/$defs/', '#/components/schemas/PersonalCentral'))
  const centralRef = name => ({ $ref: `#/components/schemas/PersonalCentral${name}` })
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
    '/central/state': { get: ['getPersonalCentralState', 'Origin-scoped central account/profile/session verification. Unknown owner fails closed. No local principal inference.', null, response('Authenticated authority or honest unconfigured/unavailable state', centralRef('State'))] },
    '/central/connection': { post: ['connectPersonalCentral', 'Explicit approved-origin password login, then public account/profile/session verification before persisting a private central-only credential. Never forwards the local instance bearer.', body(centralRef('ConnectionRequest')), response('Verified central authority', centralRef('State'))] },
    '/central/history': { get: ['getPersonalCentralHistory', 'Canonical central session.user_id string ownership and profile must match. Returns a safe bounded projection without workspace/config. Client task mapping is metadata, not a central session field.', null, response('Latest 200 messages from the verified session', centralRef('History'))] },
    '/central/run': { post: ['submitPersonalCentralRun', 'Explicit user submission to the authenticated existing session through the public chat-run namespace. No offline queue/retry or implicit session creation; acceptance is not completion.', body(centralRef('RunInput')), response('Submission accepted on a connected transport, not a completed model reply', centralRef('Submission'))] },
    '/central/events': { get: ['observePersonalCentralEvents', 'Observer-only SSE; Last-Event-ID or nonnegative after cursor resumes the bounded gateway event buffer. Reconnect sends only public resume, never run/abort/file mutation. Closing SSE detaches only the observer.', null, { description: 'Allowlisted target-bound central stream, with monotonically increasing gateway event IDs', content: { 'text/event-stream': { schema: centralRef('Event') } } }] },
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
      if (suffix.startsWith('/central/')) {
        for (const status of ['400', '403', '502', '503']) operation.responses[status] = response('Fail-closed central request/authentication/identity/transport error', centralRef('Error'))
        if (suffix === '/central/events') operation.parameters = [{ name: 'Last-Event-ID', in: 'header', schema: { type: 'integer', minimum: 0 } }, { name: 'after', in: 'query', schema: { type: 'integer', minimum: 0 } }]
      }
    }
  }
}

export const studioExtensionOpenApi = {
  id: 'personal-agent',
  tag: { name: 'Personal Agent', description: 'Receiver-owned bounded workspace file operations, explicit grants and durable operation receipts' },
  extend: extendPersonalAgentOpenApi,
}