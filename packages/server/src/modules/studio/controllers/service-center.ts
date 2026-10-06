import type { Context } from 'koa'
import { ServiceCenterError } from '../contracts/service-center/manifest'
import * as directory from '../services/service-center/directory'

const userId = (ctx: Context) => ctx.state.user?.id
const bodyOf = (ctx: Context): Record<string, unknown> => {
  const body = ctx.request.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ServiceCenterError('JSON object required')
  return body as Record<string, unknown>
}
const revisionOf = (body: Record<string, unknown>) => body.expectedRevision
const idOf = (ctx: Context) => String(ctx.params.id || '')

// The wrapper bounds domain errors without reflecting user-supplied URLs, paths or response bodies.
function handle(fn: (ctx: Context) => Promise<void>) {
  return async (ctx: Context): Promise<void> => {
    try { await fn(ctx) }
    catch (error) {
      if (!(error instanceof ServiceCenterError)) throw error
      ctx.status = error.status
      ctx.body = { error: error.message }
    }
  }
}

export const listCatalog = handle(async ctx => {
  ctx.body = await directory.catalogFor(userId(ctx))
})
export const exportManifest = handle(async ctx => {
  ctx.set('Content-Disposition', 'attachment; filename="service-center-manifest-v1.json"')
  ctx.body = await directory.manifestFor(userId(ctx))
})
export const save = handle(async ctx => {
  const body = bodyOf(ctx)
  ctx.body = await directory.saveService(userId(ctx), revisionOf(body), body.service)
})
export const remove = handle(async ctx => {
  const body = bodyOf(ctx)
  ctx.body = await directory.deleteService(userId(ctx), revisionOf(body), idOf(ctx))
})
export const preview = handle(async ctx => {
  const body = bodyOf(ctx)
  ctx.body = await directory.previewImport(userId(ctx), body.manifest)
})
export const confirm = handle(async ctx => {
  const body = bodyOf(ctx)
  ctx.body = await directory.confirmImport(userId(ctx), revisionOf(body), body.manifest, body.conflicts)
})
export const favorite = handle(async ctx => {
  const body = bodyOf(ctx)
  ctx.body = await directory.setFavorite(userId(ctx), idOf(ctx), body.favorite)
})
export const checkHealth = handle(async ctx => {
  ctx.body = await directory.checkHealth(userId(ctx), idOf(ctx))
})
export const approve = handle(async ctx => {
  const body = bodyOf(ctx)
  ctx.body = await directory.approveHealth(userId(ctx), idOf(ctx), body.approved)
})
export const editors = handle(async ctx => {
  ctx.body = await directory.listEditors(userId(ctx))
})
export const changeEditor = handle(async ctx => {
  const body = bodyOf(ctx)
  ctx.body = await directory.changeEditor(userId(ctx), Number(ctx.params.id), body.granted)
})
