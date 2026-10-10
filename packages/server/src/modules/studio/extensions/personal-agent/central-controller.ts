import type { Context } from 'koa'

import { PersonalError, matchesSchema, plainJson } from '../../../../../../personal-assistant/src'
import schema from './central.schema.json'
import type { PersonalAgentHost } from './host'
import type { CentralEvent } from './central'

async function handle(ctx: Context, host: PersonalAgentHost, action: (ownerId: string) => Promise<unknown>) {
  ctx.set('Cache-Control', 'no-store')
  try {
    const ownerId = host.actorFor(ctx)
    if (!ownerId) throw new PersonalError('FORBIDDEN', 403)
    if (!host.central) throw new PersonalError('CENTRAL_UNAVAILABLE', 503)
    ctx.body = await action(ownerId)
  } catch (error) {
    ctx.status = error instanceof PersonalError ? error.status : 503
    ctx.body = { version: 1, error: { code: error instanceof PersonalError ? error.code : 'CENTRAL_UNAVAILABLE' } }
  }
}
export const state = (ctx: Context, host: PersonalAgentHost) => handle(ctx, host, id => host.central!.forOwner(id).state())
export const connect = (ctx: Context, host: PersonalAgentHost) => handle(ctx, host, id => host.central!.connect(id, ctx.request.body))
export const history = (ctx: Context, host: PersonalAgentHost) => handle(ctx, host, id => host.central!.forOwner(id).history())
export const run = (ctx: Context, host: PersonalAgentHost) => handle(ctx, host, id => {
  if (!plainJson(ctx.request.body) || !matchesSchema(ctx.request.body, schema.$defs.RunInput, schema)) throw new PersonalError('INVALID_REQUEST')
  return host.central!.forOwner(id).send((ctx.request.body as { input: string }).input)
})
export function events(ctx: Context, host: PersonalAgentHost) {
  return handle(ctx, host, async id => {
    const after = Number(ctx.get('Last-Event-ID') || ctx.query.after || 0)
    if (!Number.isSafeInteger(after) || after < 0) throw new PersonalError('INVALID_REQUEST')
    const connection = host.central!.forOwner(id)
    // Authorize before switching to SSE. Closing a view only removes this observer.
    const pending: CentralEvent[] = []
    let ready = false
    const stop = await connection.subscribe(event => {
      if (!ready) pending.push(event)
      else if (!ctx.res.destroyed && !ctx.res.writableEnded) ctx.res.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`)
    }, after)
    if (ctx.res.destroyed) { stop(); return undefined }
    ctx.respond = false
    ctx.res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
    ctx.res.write(': connected\n\n'); ready = true
    for (const event of pending) ctx.res.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`)
    const heartbeat = setInterval(() => ctx.res.write(': alive\n\n'), 15000)
    ctx.res.once('close', () => { clearInterval(heartbeat); stop() })
    return undefined
  })
}
