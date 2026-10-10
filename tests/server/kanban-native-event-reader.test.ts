import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { latestNativeKanbanEventId, readNativeKanbanEvents, readNativeKanbanTaskHints, listNativeKanbanOrigins, nativeKanbanTransitionAfter } from '../../packages/server/src/modules/hermes/services/kanban/kanban-event-reader'
const root = join(process.cwd(), '.ekko-tmp'); mkdirSync(root, { recursive: true })
const dir = mkdtempSync(join(root,'native-events-'))
const board = { archived: false, db_path: join(dir,'native.db') }
const db = new DatabaseSync(board.db_path)
db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, assignee TEXT, status TEXT, block_kind TEXT, session_id TEXT, created_at INTEGER)')
db.exec('CREATE TABLE task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, kind TEXT, created_at INTEGER, payload TEXT, run_id INTEGER)')
const now = Math.floor(Date.now()/1000)
db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?)').run('child','developer','blocked','capability','origin-session',now)
const insert = db.prepare('INSERT INTO task_events(task_id,kind,created_at,payload,run_id) VALUES (?,?,?,?,?)')
insert.run('child','created',now,JSON.stringify({creator_task_id:'root-task'}),null)
insert.run('child','review_requested',now,'{}',1)
insert.run('child','heartbeat',now,'{}',1)
insert.run('child','completed',now,JSON.stringify({summary:'verified output'}),1)
insert.run('other','completed',now,'{}',2)
insert.run('child','changes_requested',now,'{}',2)
insert.run('child','blocked',now,JSON.stringify({kind:'capability',reason:'missing dependency'}),2)
afterAll(()=>{db.close();rmSync(dir,{recursive:true,force:true})})
describe('canonical read-only native Kanban adapter',()=>{
  it('preserves numeric identities, payload and run correlation',()=>{
    expect(latestNativeKanbanEventId(board,'child')).toBe(7)
    const events=readNativeKanbanEvents(board,'child',0)
    expect(events.map(e=>e.id)).toEqual([1,2,3,4,6,7])
    expect(events.find(e=>e.id===4)).toMatchObject({from_review:true,run_id:1,payload:{summary:'verified output'}})
    expect(events.find(e=>e.id===7)?.payload).toMatchObject({kind:'capability'})
  })
  it('provides omitted block classification and creator provenance without treating dependency edges as parent ownership',()=>{
    expect(readNativeKanbanTaskHints(board,'child')).toMatchObject({id:'child',block_kind:'capability',creator_task_id:'root-task',session_id:'origin-session'})
    expect(readNativeKanbanTaskHints(board,'missing')).toBeNull()
  })
  it('discovers only bounded, exact origin identities',()=>{
    expect(listNativeKanbanOrigins(board)).toEqual([{id:'child',session_id:'origin-session',created_at:now}])
  })
  it('detects superseding transitions before the notification poll cursor has advanced',()=>{
    expect(nativeKanbanTransitionAfter(board,'child',1)).toBe(true)
    expect(nativeKanbanTransitionAfter(board,'child',7)).toBe(false)
  })
  it('refuses archived boards and never modifies native state',()=>{
    expect(()=>readNativeKanbanEvents({...board,archived:true},'child',0)).toThrow()
    expect(db.prepare('SELECT COUNT(*) AS count FROM task_events').get()).toEqual({count:7})
  })
})
