import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { KanbanMilestoneEvent, KanbanTaskRef } from '../../packages/server/src/modules/studio/services/notifications/kanban-policy'

const base = '../../packages/server/src/modules/studio/'
describe('Studio Kanban notification persistence and diagnostic wakes', () => {
  let db: DatabaseSync, dir: string, path: string
  let service: Awaited<typeof import('../../packages/server/src/modules/studio/services/notifications/kanban-milestones')>
  let store: Awaited<typeof import('../../packages/server/src/modules/studio/repositories/kanban-session-notifications-store')>
  let user: { id: number }, input: { sessionId: string; profile: string; board: string; taskId: string }
  let task: KanbanTaskRef, events: KanbanMilestoneEvent[], source: any, wake: ReturnType<typeof vi.fn>
  const event = (id: number, kind: string, extra = {}): KanbanMilestoneEvent => ({
    id, kind, occurred_at: Date.now() / 1000, from_review: false, ...extra,
  })
  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(1_800_000_000_000)
    dir = mkdtempSync(join(tmpdir(), 'kanban-notify-')); path = join(dir, 'studio.sqlite')
    db = new DatabaseSync(path)
    vi.doMock(base + 'infrastructure/database/index', () => ({ getDb: () => db, getStoragePath: () => path, isSqliteAvailable: () => true }))
    const schemas = await import('../../packages/server/src/modules/studio/infrastructure/database/schemas')
    schemas.initAllHermesTables()
    schemas.initAllHermesTables() // idempotent schema initialization
    const users = await import('../../packages/server/src/modules/studio/repositories/users-store')
    const sessions = await import('../../packages/server/src/modules/studio/repositories/session-store')
    user = users.createUser({ username: 'owner', password: 'test', profiles: ['work', 'worker'] })!
    sessions.createSession({ id: 'session-a', profile: 'work', user_id: user.id, source: 'builtin_agent', agent: 'ekko-agent' })
    input = { sessionId: 'session-a', profile: 'work', board: 'any-board', taskId: 'task-a' }
    task = { id: 'task-a', assignee: 'worker', status: 'blocked', block_kind: 'capability' }
    events = []
    source = {
      listBoards: vi.fn(async () => [{ slug: 'any-board', archived: false }]),
      getTask: vi.fn(async () => ({ ...task })),
      latestEventId: () => events.at(-1)?.id || 0,
      events: (_board: unknown, _task: string, cursor: number) => events.filter(e => e.id > cursor),
    }
    wake = vi.fn(async () => true)
    service = await import('../../packages/server/src/modules/studio/services/notifications/kanban-milestones')
    store = await import('../../packages/server/src/modules/studio/repositories/kanban-session-notifications-store')
  })
  it('reports opted-in Hermes completion once after grace without an open browser', async () => {
    db.prepare("UPDATE sessions SET agent='hermes', source='cli' WHERE id=?").run(input.sessionId)
    const reporting = service.createKanbanMilestoneService(source, wake)
    await reporting.subscribe(user, { ...input, wakeEnabled: true })
    task = { ...task, status: 'done', block_kind: null }
    events = [event(1, 'completed')]
    await reporting.pollOnce()
    expect(wake).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(61_000)
    await reporting.pollOnce()
    await reporting.pollOnce()
    expect(wake).toHaveBeenCalledTimes(1)
    expect(wake.mock.calls[0][0]).toMatchObject({ sessionId: input.sessionId, kind: 'completed', eventIds: [1] })
    const saved = await reporting.list(user, input.sessionId, input.profile)
    expect(saved.notifications[0].wake_status).toBe('queued')
  })
  it('recognizes only completed report receipts in the same original session', async () => {
    const sessions = await import('../../packages/server/src/modules/studio/repositories/session-store')
    const marker = 'read_only_report:kanban-diagnostic:one'
    sessions.addMessage({ session_id: input.sessionId, role: 'assistant', content: 'partial', run_marker: marker })
    expect(sessions.hasCompletedReadOnlyReport(input.sessionId, marker)).toBe(false)
    sessions.addMessage({ session_id: input.sessionId, role: 'assistant', content: 'complete', run_marker: marker, finish_reason: 'read_only_report' })
    expect(sessions.hasCompletedReadOnlyReport(input.sessionId, marker)).toBe(true)
    expect(sessions.hasCompletedReadOnlyReport('other-session', marker)).toBe(false)
  })
  it('does not replay old Hermes completion when opt-in is enabled after delivery', async () => {
    db.prepare("UPDATE sessions SET agent='hermes', source='cli' WHERE id=?").run(input.sessionId)
    const reporting = service.createKanbanMilestoneService(source, wake)
    await reporting.subscribe(user, input)
    task = { ...task, status: 'done', block_kind: null }
    events = [event(1, 'completed')]
    await reporting.pollOnce()
    await reporting.subscribe(user, { ...input, wakeEnabled: true })
    await vi.advanceTimersByTimeAsync(61_000)
    await reporting.pollOnce()
    expect(wake).not.toHaveBeenCalled()
  })
  afterEach(() => {
    db?.close(); rmSync(dir, { recursive: true, force: true })
    vi.doUnmock(base + 'infrastructure/database/index'); vi.resetModules(); vi.useRealTimers()
  })
  it('uses current super-admin profile access without bypassing session ownership or disabled status', async () => {
    db.prepare("UPDATE users SET role = 'super_admin' WHERE id = ?").run(user.id)
    db.prepare('DELETE FROM user_profiles WHERE user_id = ?').run(user.id)
    const reporting = service.createKanbanMilestoneService(source, wake)
    await expect(reporting.subscribe(user, { ...input, wakeEnabled: true })).resolves.toBeTruthy()
    await expect(reporting.list(user, input.sessionId, input.profile)).resolves.toBeTruthy()
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id)
    await expect(reporting.list(user, input.sessionId, input.profile)).rejects.toMatchObject({ status: 403 })
    db.prepare("UPDATE users SET role = 'super_admin', status = 'disabled' WHERE id = ?").run(user.id)
    await expect(reporting.list(user, input.sessionId, input.profile)).rejects.toMatchObject({ status: 403 })
    db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(user.id)
    db.prepare("UPDATE sessions SET user_id = 'different-owner' WHERE id = ?").run(input.sessionId)
    await expect(reporting.list(user, input.sessionId, input.profile)).rejects.toMatchObject({ status: 403 })
  })
  it('preserves legacy notification rows without claiming downstream delivery or enabling diagnostics', async () => {
    db.exec(`
      DROP TABLE kanban_session_notifications;
      DROP TABLE kanban_session_subscriptions;
      CREATE TABLE kanban_session_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, profile TEXT NOT NULL,
        session_id TEXT NOT NULL, board TEXT NOT NULL, task_id TEXT NOT NULL,
        cursor INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
        last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE kanban_session_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT, subscription_id INTEGER NOT NULL, event_id INTEGER NOT NULL,
        kind TEXT NOT NULL, label TEXT NOT NULL, actor TEXT NOT NULL DEFAULT 'kanban/native',
        occurred_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0, last_error TEXT, delivered_at INTEGER
      );
    `)
    db.prepare('INSERT INTO kanban_session_subscriptions (id,user_id,profile,session_id,board,task_id,cursor,created_at,updated_at) VALUES (1,?,?,?,?,?,10,1,1)')
      .run(user.id, input.profile, input.sessionId, input.board, input.taskId)
    db.exec("INSERT INTO kanban_session_notifications (id,subscription_id,event_id,kind,label,occurred_at) VALUES (1,1,10,'blocked','Legacy notice',1)")
    const schemas = await import('../../packages/server/src/modules/studio/infrastructure/database/schemas')
    schemas.initAllHermesTables()
    schemas.initAllHermesTables()
    expect(store.getKanbanSessionSubscription(1)).toMatchObject({ cursor: 10, wake_enabled: 0 })
    const reporting = service.createKanbanMilestoneService(source, wake)
    expect((await reporting.list(user, input.sessionId, input.profile)).notifications).toEqual([
      expect.objectContaining({ id: 1, event_id: 10, label: 'Legacy notice', wake_status: 'none' }),
    ])
    expect(db.prepare('SELECT status,delivered_at FROM kanban_session_notifications WHERE id=1').get())
      .toEqual({ status: 'pending', delivered_at: null })
    await reporting.pollOnce()
    expect(wake).not.toHaveBeenCalled()
  })
  it('starts POST at latest but trusted binding preserves created events; duplicate POST does not skip pending events', async () => {
    events = [event(1, 'created')]
    const s = service.createKanbanMilestoneService(source, wake)
    const sub = await s.subscribe(user, input)
    await s.pollOnce()
    expect((await s.list(user, input.sessionId, input.profile)).notifications).toHaveLength(0)
    events.push(event(2, 'completed'))
    expect((await s.subscribe(user, input)).id).toBe(sub.id)
    await s.pollOnce()
    expect((await s.list(user, input.sessionId, input.profile)).notifications.map(n => n.event_id)).toEqual([2])
    s.unsubscribe(user, input.sessionId, input.profile, sub.id)
    db.prepare('DELETE FROM kanban_session_notifications').run()
    db.prepare('DELETE FROM kanban_session_subscriptions').run()
    await s.subscribe(user, { ...input, startCursor: 0 })
    await s.pollOnce()
    expect((await s.list(user, input.sessionId, input.profile)).notifications.map(n => n.event_id)).toEqual([2, 1])
    expect(wake).not.toHaveBeenCalled()
  })
  it('persists notify-only milestones without a model or wake port and ignores noise', async () => {
    const s = service.createKanbanMilestoneService(source)
    await s.subscribe(user, input)
    task.block_kind = null
    events = ['heartbeat','claimed','dependency','transient','needs_input','completed','review_requested','failed'].map((k, i) => event(i + 1, k))
    await s.pollOnce()
    const result = await s.list(user, input.sessionId, input.profile)
    expect(result.notifications.map(n => n.kind)).toEqual(['failed','review_requested','completed','needs_input'])
    expect(result.notifications.every(n => n.wake_status === 'none')).toBe(true)
    expect(store.listKanbanSessionSubscriptions()[0].cursor).toBe(8)
  })
  it('wake opt-in, 60s grace, one batch wake, stable dedupe and 10-minute subscription cooldown', async () => {
    const s = service.createKanbanMilestoneService(source, wake)
    const sub = await s.subscribe(user, { ...input, wakeEnabled: true })
    events = [event(1, 'blocked'), event(2, 'block_loop_detected')]
    await s.pollOnce(); expect(wake).not.toHaveBeenCalled()
    vi.setSystemTime(Date.now() + 60_000); await s.pollOnce()
    expect(wake).toHaveBeenCalledTimes(1)
    expect(wake.mock.calls[0][0]).toMatchObject({ eventIds: [1,2], userId: user.id, sessionId: 'session-a' })
    await s.pollOnce(); expect(wake).toHaveBeenCalledTimes(1)
    events.push(event(3, 'triage'))
    vi.setSystemTime(Date.now() + 60_000); await s.pollOnce()
    expect(wake).toHaveBeenCalledTimes(1)
    // Service reconstruction does not reset the persisted cooldown.
    const restarted = service.createKanbanMilestoneService(source, wake)
    vi.setSystemTime(Date.now() + 540_000); await restarted.pollOnce()
    expect(wake).toHaveBeenCalledTimes(2)
    expect(store.getKanbanSessionSubscription(sub.id)?.last_wake_at).toBe(Date.now())
  })
  it.each(['ready','running','done'])('suppresses recovered %s tasks during recovery grace', async status => {
    const s = service.createKanbanMilestoneService(source, wake)
    await s.subscribe(user, { ...input, wakeEnabled: true })
    events = [event(1, 'crashed')]; await s.pollOnce()
    task.status = status; vi.setSystemTime(Date.now() + 60_000); await s.pollOnce()
    expect(wake).not.toHaveBeenCalled()
    expect((await s.list(user, input.sessionId, input.profile)).notifications[0].wake_status).toBe('suppressed')
  })
  it('later completion supersedes diagnostics; partial source pages do not wake prematurely', async () => {
    const s = service.createKanbanMilestoneService(source, wake)
    await s.subscribe(user, { ...input, wakeEnabled: true })
    events = [event(1, 'gave_up'), event(2, 'completed')]
    source.events = (_b: unknown, _t: string, cursor: number) => events.filter(e => e.id > cursor).slice(0,1)
    await s.pollOnce(); vi.setSystemTime(Date.now() + 60_000)
    expect(wake).not.toHaveBeenCalled()
    await s.pollOnce()
    expect(wake).not.toHaveBeenCalled()
    expect((await s.list(user, input.sessionId, input.profile)).notifications.find(n => n.event_id === 1)?.wake_status).toBe('suppressed')
  })
  it('retains attempts and queue identity on throw/false and exhausts after three requests', async () => {
    wake.mockRejectedValueOnce(new Error('queue failed')).mockResolvedValue(false)
    let s = service.createKanbanMilestoneService(source, wake)
    const sub = await s.subscribe(user, { ...input, wakeEnabled: true })
    events = [event(1, 'gave_up')]
    await s.pollOnce(); vi.setSystemTime(Date.now() + 60_000); await s.pollOnce()
    const first = wake.mock.calls[0][0].queueId
    expect(store.pendingKanbanNotifications(sub.id)[0].attempts).toBe(1)
    // Reopen actual SQLite file and reconstruct service, simulating process restart.
    db.close(); db = new DatabaseSync(path); s = service.createKanbanMilestoneService(source, wake)
    await s.pollOnce(); expect(wake).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 60_000); await s.pollOnce()
    vi.setSystemTime(Date.now() + 60_000); await s.pollOnce()
    vi.setSystemTime(Date.now() + 60_000); await s.pollOnce()
    expect(wake).toHaveBeenCalledTimes(3)
    expect(wake.mock.calls.map(c => c[0].queueId)).toEqual([first,first,first])
    expect((await s.list(user, input.sessionId, input.profile)).notifications[0].wake_status).toBe('exhausted')
  })
  it('replays abandoned pre-enqueue leases after restart and fences stale lease completions', async () => {
    const s = service.createKanbanMilestoneService(source, wake)
    const sub = await s.subscribe(user, { ...input, wakeEnabled: true })
    events = [event(1, 'triage')]; await s.pollOnce(); vi.setSystemTime(Date.now() + 60_000)
    const claimed = store.claimKanbanWake(sub.id, Date.now(), 600_000, 60_000, 3)
    expect(claimed).toHaveLength(1)
    db.close(); db = new DatabaseSync(path)
    const restarted = service.createKanbanMilestoneService(source, wake)
    await restarted.pollOnce(); expect(wake).not.toHaveBeenCalled()
    vi.setSystemTime(Date.now() + 60_000); await restarted.pollOnce()
    expect(wake.mock.calls[0][0].queueId).toBe(claimed[0].queue_id)
    store.finishKanbanWake(sub.id, claimed[0].queue_id!, false, Date.now(), 3, claimed[0].lease_until)
    expect((await restarted.list(user, input.sessionId, input.profile)).notifications[0].wake_status).toBe('queued')
  })
  it('bounds a hanging port with timeout and retries the same durable queueId', async () => {
    wake.mockImplementation(() => new Promise(() => {}))
    const s = service.createKanbanMilestoneService(source, wake)
    const sub = await s.subscribe(user, { ...input, wakeEnabled: true })
    events = [event(1, 'gave_up')]; await s.pollOnce(); vi.setSystemTime(Date.now() + 60_000)
    const polling = s.pollOnce()
    await vi.advanceTimersByTimeAsync(30_000); await polling
    expect(store.pendingKanbanNotifications(sub.id)[0]).toMatchObject({ attempts: 1, wake_status: 'pending', last_error: 'wake_queue_failed' })
  })
  it('revalidates session ownership/profile and never trusts forged super_admin role for task access', async () => {
    const s = service.createKanbanMilestoneService(source, wake)
    await expect(s.subscribe(user, { ...input, profile: 'worker' })).rejects.toMatchObject({ code: 'session_forbidden' })
    await expect(s.subscribe({ id: user.id + 100 }, input)).rejects.toMatchObject({ code: 'session_forbidden' })
    task.assignee = 'secret'
    await expect(s.subscribe({ ...user, role: 'super_admin' } as any, input)).rejects.toMatchObject({ code: 'kanban_task_forbidden' })
    task.id = 'other'
    await expect(s.subscribe(user, input)).rejects.toMatchObject({ code: 'kanban_task_forbidden' })
    task.id = input.taskId; task.assignee = null
    await expect(s.subscribe(user, input)).rejects.toMatchObject({ code: 'kanban_task_forbidden' })
  })
  it.each(['task','profile','owner','disabled'])('revocation %s stops pending wake and hides notifications', async revoke => {
    const s = service.createKanbanMilestoneService(source, wake)
    const sub = await s.subscribe(user, { ...input, wakeEnabled: true })
    events = [event(1, 'triage')]; await s.pollOnce()
    if (revoke === 'task') task.assignee = 'secret'
    if (revoke === 'profile') db.prepare('DELETE FROM user_profiles WHERE user_id = ? AND profile_name = ?').run(user.id, 'worker')
    if (revoke === 'owner') db.prepare('UPDATE sessions SET user_id = ? WHERE id = ?').run('999', input.sessionId)
    if (revoke === 'disabled') db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(user.id)
    vi.setSystemTime(Date.now() + 60_000); await s.pollOnce()
    expect(wake).not.toHaveBeenCalled()
    expect(store.getKanbanSessionSubscription(sub.id)).toMatchObject({ active: 0, last_error: 'authorization_revoked' })
    expect(store.pendingKanbanNotifications(sub.id)).toHaveLength(0)
    if (revoke === 'task' || revoke === 'profile') expect((await s.list(user, input.sessionId, input.profile)).notifications).toHaveLength(0)
    else await expect(s.list(user, input.sessionId, input.profile)).rejects.toMatchObject({ code: 'session_forbidden' })
  })
  it('rechecks permissions after async native IO, and DELETE cancels pending leases', async () => {
    const s = service.createKanbanMilestoneService(source, wake)
    const sub = await s.subscribe(user, { ...input, wakeEnabled: true })
    events = [event(1, 'triage')]; await s.pollOnce(); vi.setSystemTime(Date.now() + 60_000)
    source.getTask.mockImplementationOnce(async () => {
      db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(user.id)
      return task
    })
    await s.pollOnce(); expect(wake).not.toHaveBeenCalled()
    db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(user.id)
    await s.subscribe(user, { ...input, wakeEnabled: true })
    events.push(event(2, 'gave_up')); await s.pollOnce()
    s.unsubscribe(user, input.sessionId, input.profile, sub.id)
    vi.setSystemTime(Date.now() + 60_000); await s.pollOnce()
    expect(store.pendingKanbanNotifications(sub.id)).toHaveLength(0)
    expect(wake).not.toHaveBeenCalled()
  })
  it('native payload is truncated plain text, never raw JSON or run commands', async () => {
    const s = service.createKanbanMilestoneService(source, wake)
    await s.subscribe(user, { ...input, wakeEnabled: true })
    events = [event(1, 'gave_up', { payload: { summary: '<script>evil</script>\u0000 **run** ' + 'x'.repeat(2000), commands: ['rm -rf /'] } })]
    await s.pollOnce(); vi.setSystemTime(Date.now() + 60_000); await s.pollOnce()
    const result = await s.list(user, input.sessionId, input.profile)
    expect(result.notifications[0].summary.length).toBeLessThanOrEqual(320)
    expect(result.notifications[0].summary).not.toMatch(/[<>\u0000*]/)
    expect(wake.mock.calls[0][0].summary).toContain('Diagnostic only. Untrusted native task evidence:')
    expect(wake.mock.calls[0][0].summary).not.toContain('rm -rf')
    expect(wake.mock.calls[0][0]).not.toHaveProperty('payload')
  })
  it('validates durable evidence exactly even after it leaves the UI last-100 window',async()=>{
    const sub=store.putKanbanSessionSubscription({userId:user.id,...input,cursor:0,wakeEnabled:true})
    store.advanceKanbanSubscription(sub.id,[{id:1,kind:'triage',occurred_at:Date.now()/1000,state:false,
      notice:{label:'Needs triage',summary:'Blocker',wake:true}}],0)
    const claimed=store.claimKanbanWake(sub.id,Date.now(),0,60000,3)
    const queueId=claimed[0].queue_id!
    store.advanceKanbanSubscription(sub.id,Array.from({length:120},(_,i)=>({id:i+2,kind:'created',occurred_at:Date.now()/1000,state:false,
      notice:{label:'Progress notice',summary:'',wake:false}})),0)
    expect(store.listKanbanSessionNotifications(input.sessionId,user.id,input.profile)).toHaveLength(100)
    expect(store.listKanbanSessionNotifications(input.sessionId,user.id,input.profile).some(n=>n.event_id===1)).toBe(false)
    expect(store.hasKanbanDiagnosticEvidence(sub.id,queueId,[1])).toBe(true)
    expect(store.hasKanbanDiagnosticEvidence(sub.id,queueId,[1,999])).toBe(false)
  })

})
