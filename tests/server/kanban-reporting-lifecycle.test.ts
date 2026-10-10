import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  boards: vi.fn(async () => []),
  poll: vi.fn(async () => {}),
  pump: vi.fn(async () => {}),
  accept: vi.fn(async () => true),
  createService: vi.fn(),
  createDispatcher: vi.fn(),
  setService: vi.fn(),
  setOrigin: vi.fn(),
  warn: vi.fn(),
}))
vi.mock('../../packages/server/src/modules/hermes/services/kanban/kanban-service', () => ({
  listBoards: mocks.boards, getTask: vi.fn(),
}))
vi.mock('../../packages/server/src/modules/hermes/services/kanban/kanban-event-reader', () => ({
  latestNativeKanbanEventId: vi.fn(), readNativeKanbanEvents: vi.fn(), readNativeKanbanTaskHints: vi.fn(),
  listNativeKanbanOrigins: vi.fn(), nativeKanbanTransitionAfter: vi.fn(),
}))
vi.mock('../../packages/server/src/modules/studio/services/notifications/kanban-milestones', () => ({
  createKanbanMilestoneService: mocks.createService, setKanbanMilestoneService: mocks.setService,
}))
vi.mock('../../packages/server/src/modules/studio/services/notifications/kanban-diagnostic-dispatcher', () => ({
  createKanbanDiagnosticDispatcher: mocks.createDispatcher,
}))
vi.mock('../../packages/server/src/modules/studio/repositories/kanban-session-notifications-store', () => ({
  hasKanbanDiagnosticEvidence: vi.fn(), listKanbanSessionSubscriptions: () => [],
}))
vi.mock('../../packages/server/src/modules/studio/repositories/session-store', () => ({ getSession: vi.fn() }))
vi.mock('../../packages/server/src/modules/studio/repositories/users-store', () => ({
  findUserById: vi.fn(), userCanAccessProfile: vi.fn(),
}))
vi.mock('../../packages/server/src/modules/studio/public/kanban-notifications', () => ({
  setKanbanOriginPort: mocks.setOrigin,
}))
vi.mock('../../packages/server/src/modules/studio/public/logging', () => ({ logger: { warn: mocks.warn } }))
import { startKanbanReporting } from '../../packages/server/src/bootstrap/kanban-reporting'

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.stubEnv('STUDIO_KANBAN_REPORTING_ENABLED', '')
  vi.stubEnv('STUDIO_KANBAN_DIAGNOSTICS_ENABLED', '')
  mocks.boards.mockResolvedValue([])
  mocks.createService.mockReturnValue({ pollOnce: mocks.poll })
  mocks.createDispatcher.mockReturnValue({ pump: mocks.pump, accept: mocks.accept })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('Kanban opt-in lifecycle', () => {
  it.each(['', '1'])('does no native IO, database recovery, polling or queue work while reporting is off (diagnostics=%s)', async diagnostics => {
    vi.stubEnv('STUDIO_KANBAN_DIAGNOSTICS_ENABLED', diagnostics)
    const stop = startKanbanReporting({} as never)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.boards).not.toHaveBeenCalled()
    expect(mocks.createService).not.toHaveBeenCalled()
    expect(mocks.createDispatcher).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    stop()
  })
  it('runs notification-only without creating a diagnostic dispatcher and releases the timer on shutdown', async () => {
    vi.stubEnv('STUDIO_KANBAN_REPORTING_ENABLED', '1')
    const stop = startKanbanReporting({} as never)
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.createService).toHaveBeenCalledWith(expect.anything(), undefined)
    expect(mocks.poll).toHaveBeenCalledOnce()
    expect(mocks.createDispatcher).not.toHaveBeenCalled()
    expect(mocks.pump).not.toHaveBeenCalled()
    stop()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.poll).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    expect(mocks.setService).toHaveBeenLastCalledWith(null)
    expect(mocks.setOrigin).toHaveBeenLastCalledWith(null)
  })
  it('only connects the diagnostic admission port with both explicit switches', async () => {
    vi.stubEnv('STUDIO_KANBAN_REPORTING_ENABLED', '1')
    vi.stubEnv('STUDIO_KANBAN_DIAGNOSTICS_ENABLED', '1')
    const stop = startKanbanReporting({} as never)
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.createService).toHaveBeenCalledWith(expect.anything(), mocks.accept)
    expect(mocks.pump).toHaveBeenCalledOnce()
    stop()
  })
  it('reports discovery failures without exposing native error messages', async () => {
    vi.stubEnv('STUDIO_KANBAN_REPORTING_ENABLED', '1')
    mocks.boards.mockRejectedValueOnce(new Error('private board path'))
    const stop = startKanbanReporting({} as never)
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.warn).toHaveBeenCalledWith({ error: 'Error' }, '[kanban-reporting] discovery failed')
    expect(mocks.poll).toHaveBeenCalledOnce()
    stop()
  })
})
