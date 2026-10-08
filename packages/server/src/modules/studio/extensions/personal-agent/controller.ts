import type { Context } from 'koa'
import { PersonalError, matchesSchema, protocolSchema, plainJson } from '../../../../../../personal-assistant/src'
import type { PersonalAgentHost } from './host'
import type { PersonalAgentService } from './service'

async function handle(ctx: Context, host: PersonalAgentHost, fn: (ownerId: string) => Promise<unknown> | unknown) {
  try {
    const ownerId = host.actorFor(ctx)
    if (!ownerId) throw new PersonalError('FORBIDDEN', 403)
    ctx.set('Cache-Control', 'no-store')
    ctx.body = await fn(ownerId)
  } catch (error) {
    const safe = error instanceof PersonalError ? error : new PersonalError('IO_FAILURE', 500)
    ctx.status = safe.status
    ctx.body = { version: 1, error: { code: safe.code } }
  }
}
function body(ctx: Context, schema: string) {
  const value = ctx.request.body
  if (!plainJson(value) || !matchesSchema(value, protocolSchema.$defs[schema])) throw new PersonalError('INVALID_REQUEST')
  return value as Record<string, any>
}
function required(service: PersonalAgentService | null): PersonalAgentService {
  if (!service) throw new PersonalError('UNAVAILABLE', 503)
  return service
}
export async function state(ctx: Context, host: PersonalAgentHost, service: PersonalAgentService | null) {
  return handle(ctx, host, ownerId => service ? service.stateFor(ownerId) : { version: 1, configured: false, workspaces: [], peers: [] })
}
export async function execute(ctx: Context, host: PersonalAgentHost, service: PersonalAgentService | null) {
  return handle(ctx, host, ownerId => required(service).execute(ownerId, body(ctx, 'Request')))
}
export async function setGrant(ctx: Context, host: PersonalAgentHost, service: PersonalAgentService | null) {
  return handle(ctx, host, ownerId => { const input = body(ctx, 'GrantUpdate'); return required(service).setGrant(ownerId, ctx.params.id, input.expectedRevision, input.capabilities) })
}
export async function confirmDelete(ctx: Context, host: PersonalAgentHost, service: PersonalAgentService | null) {
  return handle(ctx, host, ownerId => { const input = body(ctx, 'ConfirmationRequest'); return required(service).confirmDelete(ownerId, input.sourceDeviceId, input.request) })
}
export async function restore(ctx: Context, host: PersonalAgentHost, service: PersonalAgentService | null) {
  return handle(ctx, host, ownerId => required(service).restore(ownerId, body(ctx, 'RestoreRequest').receiptId))
}
