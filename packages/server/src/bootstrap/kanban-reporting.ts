import type { ChatRunSocket } from '../modules/studio/sockets/chat-run'
import { listBoards, getTask } from '../modules/hermes/services/kanban/kanban-service'
import { latestNativeKanbanEventId, readNativeKanbanEvents, readNativeKanbanTaskHints, listNativeKanbanOrigins, nativeKanbanTransitionAfter } from '../modules/hermes/services/kanban/kanban-event-reader'
import { createKanbanMilestoneService, setKanbanMilestoneService, type KanbanDiagnosticWake } from '../modules/studio/services/notifications/kanban-milestones'
import { createKanbanDiagnosticDispatcher } from '../modules/studio/services/notifications/kanban-diagnostic-dispatcher'
import { kanbanRecovered } from '../modules/studio/services/notifications/kanban-policy'
import { hasKanbanDiagnosticEvidence, listKanbanSessionSubscriptions } from '../modules/studio/repositories/kanban-session-notifications-store'
import { getSession } from '../modules/studio/repositories/session-store'
import { findUserById, userCanAccessProfile } from '../modules/studio/repositories/users-store'
import { isBuiltinEkkoAgent } from '../modules/studio/contracts/history-source'
import { setKanbanOriginPort } from '../modules/studio/public/kanban-notifications'
import { logger } from '../modules/studio/public/logging'

/** Composition only: Studio owns reporting state; the Hermes adapter is read-only. */
export function startKanbanReporting(queue: ChatRunSocket): () => void {
  if (process.env.STUDIO_KANBAN_REPORTING_ENABLED !== '1') return () => {}
  const diagnosticsEnabled = process.env.STUDIO_KANBAN_DIAGNOSTICS_ENABLED === '1'
  const boards = () => listBoards({ canonicalBoard: true })
  const source = {
    listBoards: boards,
    getTask: async (taskId: string, boardSlug: string) => {
      const board = (await boards()).find(b => b.slug === boardSlug && !b.archived)
      if (!board) return null
      const detail = await getTask(taskId, { board: boardSlug, canonicalBoard: true })
      if (!detail || detail.task.id !== taskId) return null
      const hints = readNativeKanbanTaskHints(board, taskId)
      return hints ? { ...detail, task: { ...detail.task, ...hints } } : null
    },
    latestEventId: latestNativeKanbanEventId,
    events: (board: Parameters<typeof readNativeKanbanEvents>[0], taskId: string, afterId: number) =>
      readNativeKanbanEvents(board, taskId, afterId).map(event => ({ ...event, run_id: event.run_id == null ? null : String(event.run_id) })),
  }
  async function validateWake(input: KanbanDiagnosticWake): Promise<boolean> {
    const session = getSession(input.sessionId)
    const user = findUserById(input.userId)
    if (!session || !user || user.status !== 'active' || session.is_archived
      || String(session.user_id) !== String(input.userId) || session.profile !== input.profile
      || !isBuiltinEkkoAgent(session.agent) || !userCanAccessProfile(input.userId, input.profile)) return false
    const sub = listKanbanSessionSubscriptions(input.sessionId, input.userId).find(s =>
      s.active && s.wake_enabled && s.profile === input.profile && s.board === input.board && s.task_id === input.taskId)
    if (!sub || input.eventIds.some(id => id < sub.state_event_id)) return false
    if (!hasKanbanDiagnosticEvidence(sub.id,input.queueId,input.eventIds)) return false
    const board=(await boards()).find(b=>b.slug===input.board&&!b.archived)
    if(!board || nativeKanbanTransitionAfter(board,input.taskId,Math.max(...input.eventIds))) return false
    const detail = await source.getTask(input.taskId, input.board)
    if (!detail || !detail.task.assignee || !userCanAccessProfile(input.userId, detail.task.assignee)
      || detail.task.creator_task_id || kanbanRecovered(detail.task)
      || ['needs_input','dependency','transient'].includes(detail.task.block_kind || '')) return false
    // Repeat cheap checks after native IO; dequeue also invokes this validation.
    const current = getSession(input.sessionId)
    return !!current && String(current.user_id) === String(input.userId) && !current.is_archived
      && current.profile === input.profile && findUserById(input.userId)?.status === 'active'
      && userCanAccessProfile(input.userId, input.profile)
      && !!listKanbanSessionSubscriptions(input.sessionId, input.userId).find(s => s.id === sub.id && s.active && s.wake_enabled)
  }
  const dispatcher = diagnosticsEnabled ? createKanbanDiagnosticDispatcher(queue, validateWake) : null
  const service = createKanbanMilestoneService(source, dispatcher?.accept)
  setKanbanMilestoneService(service)
  setKanbanOriginPort({
    validate(userId, sessionId) {
      const session = getSession(sessionId)
      if (!session || session.is_archived || String(session.user_id) !== String(userId)
        || findUserById(userId)?.status !== 'active' || !userCanAccessProfile(userId, session.profile || 'default'))
        throw new Error('kanban_origin_forbidden')
      return session.profile || 'default'
    },
    async bind(input) {
      if (listKanbanSessionSubscriptions(input.sessionId,input.userId).some(s => s.board === input.board && s.task_id === input.taskId)) return
      await service.subscribe({ id: input.userId }, { sessionId: input.sessionId, profile: input.profile,
        board: input.board, taskId: input.taskId, startCursor: 0 })
    },
  })
  let stopped = false, ticking = false, lastDiscovery = 0
  async function discoverOrigins() {
    if (Date.now() - lastDiscovery < 60_000) return
    lastDiscovery = Date.now()
    const existing = listKanbanSessionSubscriptions()
    for (const board of await boards()) {
      if (board.archived || !board.db_path) continue
      for (const task of listNativeKanbanOrigins(board)) {
        const session = getSession(task.session_id)
        if (!session || session.is_archived || !session.user_id) continue
        const user = findUserById(Number(session.user_id))
        if (!user || user.status !== 'active') continue
        if (existing.some(s => s.user_id === user.id && s.session_id === session.id && s.board === board.slug && s.task_id === task.id)) continue
        // Do not auto-reactivate a user-disabled subscription, or fan out child reports.
        if (listKanbanSessionSubscriptions(session.id,user.id).some(s => s.board === board.slug && s.task_id === task.id)) continue
        const hints = readNativeKanbanTaskHints(board,task.id)
        if (!hints || hints.creator_task_id) continue
        try { await service.subscribe(user, { sessionId: session.id, profile: session.profile || 'default',
          board: board.slug, taskId: task.id, startCursor: 0 }) }
        catch { /* Only trusted, still-authorized exact source identities are bound. */ }
      }
    }
  }
  async function tick() {
    if (stopped || ticking) return
    ticking = true
    try {
      await discoverOrigins().catch(error => {
        logger.warn({ error: error instanceof Error ? error.name : 'unknown' }, '[kanban-reporting] discovery failed')
      })
      if (stopped) return
      await service.pollOnce()
      if (!stopped) await dispatcher?.pump()
    } catch (error) { logger.warn({ error: error instanceof Error ? error.name : 'unknown' }, '[kanban-reporting] tick failed') }
    finally { ticking = false }
  }
  const timer = setInterval(() => { void tick() }, 10_000)
  timer.unref()
  void tick()
  return () => { stopped = true; clearInterval(timer); setKanbanOriginPort(null); setKanbanMilestoneService(null) }
}
