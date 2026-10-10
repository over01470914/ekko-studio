import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({db:null as DatabaseSync|null}))
vi.mock('../../packages/server/src/modules/studio/infrastructure/database',()=>({getDb:()=>state.db}))
import { KANBAN_DIAGNOSTIC_RUNS_SCHEMA, KANBAN_DIAGNOSTIC_ADMISSIONS_SCHEMA } from '../../packages/server/src/modules/studio/infrastructure/database/schemas'
import { createKanbanDiagnosticDispatcher } from '../../packages/server/src/modules/studio/services/notifications/kanban-diagnostic-dispatcher'
import { pendingKanbanDiagnostics } from '../../packages/server/src/modules/studio/repositories/kanban-diagnostic-store'
const input={sessionId:'owned-session',profile:'default',userId:1,queueId:'kanban-diagnostic:one',eventIds:[1],board:'board',taskId:'one',kind:'triage',summary:'First task blocked'}
beforeEach(()=>{state.db=new DatabaseSync(':memory:');state.db.exec(`CREATE TABLE kanban_diagnostic_runs (${Object.entries(KANBAN_DIAGNOSTIC_RUNS_SCHEMA).map(([k,v])=>`${k} ${v}`).join(',')})`);state.db.exec(`CREATE TABLE kanban_diagnostic_admissions (${Object.entries(KANBAN_DIAGNOSTIC_ADMISSIONS_SCHEMA).map(([k,v])=>`${k} ${v}`).join(',')})`)})
afterEach(()=>{state.db?.close();state.db=null;vi.useRealTimers()})
describe('durable bounded Kanban diagnostics',()=>{
  it('persists before admission, coalesces tasks into one report and acknowledges model completion',async()=>{
    const enqueue=vi.fn(async()=>true)
    const dispatcher=createKanbanDiagnosticDispatcher({enqueueReadOnlyDiagnostic:enqueue},async()=>true)
    await dispatcher.accept(input)
    await dispatcher.accept({...input,queueId:'kanban-diagnostic:two',taskId:'two',eventIds:[2],summary:'Second blocked'})
    expect(pendingKanbanDiagnostics()).toHaveLength(2)
    await dispatcher.pump()
    expect(enqueue).toHaveBeenCalledTimes(1)
    const request=enqueue.mock.calls[0][0] as any
    expect(request.input).toContain('board/one');expect(request.input).toContain('board/two')
    expect(request.input).toContain('untrusted evidence')
    expect(request).not.toHaveProperty('board')
    expect(request).not.toHaveProperty('taskId')
    await request.authorize()
    expect(pendingKanbanDiagnostics()).toHaveLength(0)
    request.onEvent('run.completed',{})
    await dispatcher.pump();expect(enqueue).toHaveBeenCalledTimes(1)
  })
  it('replays an accepted but not started queue after restart with the same identity',async()=>{
    const first=vi.fn(async()=>true)
    const original=createKanbanDiagnosticDispatcher({enqueueReadOnlyDiagnostic:first},async()=>true)
    await original.accept(input);await original.pump()
    const second=vi.fn(async()=>true)
    const restarted=createKanbanDiagnosticDispatcher({enqueueReadOnlyDiagnostic:second},async()=>true)
    await restarted.pump()
    expect((second.mock.calls[0][0] as any).queueId).toBe(input.queueId)
  })
  it('recovers lost running ownership and limits failures to three model attempts',async()=>{
    vi.useFakeTimers();vi.setSystemTime(2_000_000)
    const enqueue=vi.fn(async()=>true)
    let dispatcher=createKanbanDiagnosticDispatcher({enqueueReadOnlyDiagnostic:enqueue},async()=>true)
    await dispatcher.accept(input)
    for(let attempt=0;attempt<3;attempt++){
      await dispatcher.pump();const request=enqueue.mock.calls.at(-1)![0] as any
      await request.authorize()
      if(attempt===0) dispatcher=createKanbanDiagnosticDispatcher({enqueueReadOnlyDiagnostic:enqueue},async()=>true)
      else request.onEvent('run.failed',{})
      vi.setSystemTime(Date.now()+600_001)
    }
    await dispatcher.pump();expect(enqueue).toHaveBeenCalledTimes(3)
    expect(pendingKanbanDiagnostics()).toHaveLength(0)
  })
  it('revalidates at execution and cancels a revoked request without a model call',async()=>{
    let allowed=true
    const enqueue=vi.fn(async()=>true)
    const dispatcher=createKanbanDiagnosticDispatcher({enqueueReadOnlyDiagnostic:enqueue},async()=>allowed)
    await dispatcher.accept(input);await dispatcher.pump();allowed=false
    const request=enqueue.mock.calls[0][0] as any
    await expect(request.authorize()).rejects.toThrow('superseded')
    expect(pendingKanbanDiagnostics()).toHaveLength(0)
  })
  it('defers other tasks for the same session during durable cooldown',async()=>{
    const enqueue=vi.fn(async()=>true)
    const dispatcher=createKanbanDiagnosticDispatcher({enqueueReadOnlyDiagnostic:enqueue},async()=>true)
    await dispatcher.accept(input);await dispatcher.pump()
    const first=enqueue.mock.calls[0][0] as any;await first.authorize();first.onEvent('run.completed',{})
    await dispatcher.accept({...input,queueId:'kanban-diagnostic:next',taskId:'next'})
    await dispatcher.pump();expect(enqueue).toHaveBeenCalledTimes(1)
    expect(pendingKanbanDiagnostics()).toHaveLength(1)
  })
  it('settles user cancellation without leaving a running ownership slot',async()=>{
    const enqueue=vi.fn(async()=>true)
    const dispatcher=createKanbanDiagnosticDispatcher({enqueueReadOnlyDiagnostic:enqueue},async()=>true)
    await dispatcher.accept(input);await dispatcher.pump()
    const request=enqueue.mock.calls[0][0] as any
    await request.authorize();request.onEvent('run.cancelled',{})
    expect(state.db!.prepare("SELECT COUNT(*) AS count FROM kanban_diagnostic_admissions WHERE status='running'").get()).toEqual({count:0})
    expect(pendingKanbanDiagnostics()).toHaveLength(0)
  })
  it('reserves one global model slot and defers other sessions until the active report ends',async()=>{
    const enqueue=vi.fn(async()=>true)
    const dispatcher=createKanbanDiagnosticDispatcher({enqueueReadOnlyDiagnostic:enqueue},async()=>true)
    await dispatcher.accept(input)
    await dispatcher.accept({...input,sessionId:'another-session',queueId:'kanban-diagnostic:another'})
    await dispatcher.pump()
    const first=enqueue.mock.calls[0][0] as any,second=enqueue.mock.calls[1][0] as any
    await first.authorize()
    await expect(second.authorize()).rejects.toThrow('budget_deferred')
    first.onEvent('run.completed',{usage:{input_tokens:9000,output_tokens:1000}})
    await second.authorize()
    const budget=state.db!.prepare('SELECT SUM(tokens) AS tokens FROM kanban_diagnostic_admissions').get() as any
    expect(budget.tokens).toBe(18192)
  })
  it('defers execution-time budget races without consuming attempts or cancelling the durable request',async()=>{
    vi.useFakeTimers();vi.setSystemTime(2_000_000)
    const enqueue=vi.fn(async()=>true)
    const dispatcher=createKanbanDiagnosticDispatcher({enqueueReadOnlyDiagnostic:enqueue},async()=>true)
    await dispatcher.accept(input)
    await dispatcher.accept({...input,sessionId:'second-session',queueId:'kanban-diagnostic:deferred'})
    await dispatcher.pump()
    const first=enqueue.mock.calls[0][0] as any,second=enqueue.mock.calls[1][0] as any
    await first.authorize()
    await expect(second.authorize()).rejects.toThrow('budget_deferred')
    second.onEvent('run.cancelled',{reason:'diagnostic_budget_deferred'})
    const row=state.db!.prepare('SELECT status, attempts, next_attempt_at FROM kanban_diagnostic_runs WHERE queue_id=?').get('kanban-diagnostic:deferred') as any
    expect(row).toMatchObject({status:'pending',attempts:0})
    expect(row.next_attempt_at).toBeGreaterThan(Date.now())
    await dispatcher.pump();expect(enqueue).toHaveBeenCalledTimes(2)
    first.onEvent('run.completed',{})
    vi.setSystemTime(Date.now()+60_001)
    await dispatcher.pump();expect(enqueue).toHaveBeenCalledTimes(3)
    await (enqueue.mock.calls[2][0] as any).authorize()
  })
  it('enforces the durable hourly reservation window across independent sessions',async()=>{
    const enqueue=vi.fn(async()=>true)
    const dispatcher=createKanbanDiagnosticDispatcher({enqueueReadOnlyDiagnostic:enqueue},async()=>true)
    for(let i=0;i<5;i++){
      await dispatcher.accept({...input,sessionId:'session-'+i,queueId:'kanban-diagnostic:'+i})
      await dispatcher.pump()
      const request=enqueue.mock.calls.at(-1)![0] as any
      if(i<4){await request.authorize();request.onEvent('run.completed',{})}
      else {
        expect(enqueue).toHaveBeenCalledTimes(4)
        expect(pendingKanbanDiagnostics()).toHaveLength(1)
      }
    }
    expect(state.db!.prepare('SELECT COUNT(*) AS count FROM kanban_diagnostic_admissions').get()).toEqual({count:4})
  })

})
