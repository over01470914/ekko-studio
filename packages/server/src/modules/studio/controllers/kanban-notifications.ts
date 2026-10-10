import type { Context } from 'koa'
import { getKanbanMilestoneService, kanbanReportingCapabilities, KanbanMilestoneError } from '../services/notifications/kanban-milestones'

export function getKanbanReportingCapabilities(ctx: Context): void {
  if (!ctx.state.user || ctx.state.runCredential) {
    ctx.status = 401
    ctx.body = { error: 'unauthorized' }
    return
  }
  ctx.body = kanbanReportingCapabilities()
}

function respondError(ctx: Context, error: unknown): void {
  ctx.status = error instanceof KanbanMilestoneError ? error.status : 503
  ctx.body = { error: error instanceof KanbanMilestoneError ? error.code : 'kanban_milestones_unavailable' }
}

function profile(ctx: Context): string {
  return typeof ctx.query.profile === 'string' && ctx.query.profile ? ctx.query.profile : (ctx.state.profile?.name || 'default')
}

export async function listKanbanNotifications(ctx: Context): Promise<void> {
  try {
    if (!ctx.state.user || ctx.state.runCredential) throw new KanbanMilestoneError(401, 'unauthorized')
    ctx.body = await getKanbanMilestoneService().list(ctx.state.user, ctx.params.id, profile(ctx))
  } catch (error) { respondError(ctx, error) }
}

export async function subscribeKanbanNotifications(ctx: Context): Promise<void> {
  try {
    if (!ctx.state.user || ctx.state.runCredential) throw new KanbanMilestoneError(401, 'unauthorized')
    const body = (ctx.request.body && typeof ctx.request.body === 'object')
      ? ctx.request.body as Record<string, unknown> : {}
    if (typeof body.board !== 'string' || typeof body.task_id !== 'string'
      || !body.board.trim() || !body.task_id.trim() || body.board.length > 64 || body.task_id.length > 128
      || (body.wake_enabled !== undefined && typeof body.wake_enabled !== 'boolean')) {
      throw new KanbanMilestoneError(400, 'invalid_kanban_subscription')
    }
    const subscription = await getKanbanMilestoneService().subscribe(ctx.state.user, {
      sessionId: ctx.params.id, profile: profile(ctx), board: body.board, taskId: body.task_id, wakeEnabled: body.wake_enabled === true,
    })
    ctx.status = 200
    ctx.body = { id: subscription.id, board: subscription.board, task_id: subscription.task_id,
      active: Boolean(subscription.active), wake_enabled: Boolean(subscription.wake_enabled), created_at: subscription.created_at }
  } catch (error) { respondError(ctx, error) }
}

export function unsubscribeKanbanNotifications(ctx: Context): void {
  try {
    if (!ctx.state.user || ctx.state.runCredential) throw new KanbanMilestoneError(401, 'unauthorized')
    const id = Number(ctx.params.subscriptionId)
    if (!Number.isSafeInteger(id) || id <= 0) throw new KanbanMilestoneError(400, 'invalid_subscription_id')
    getKanbanMilestoneService().unsubscribe(ctx.state.user, ctx.params.id, profile(ctx), id)
    ctx.body = { ok: true }
  } catch (error) { respondError(ctx, error) }
}
