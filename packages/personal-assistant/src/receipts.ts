import { DatabaseSync } from 'node:sqlite'
import { openSync, closeSync, writeFileSync, mkdirSync, lstatSync, readFileSync, unlinkSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { PersonalError, limits } from './protocol'

export class ReceiptStore {
  readonly db: DatabaseSync
  readonly cursorKey: Buffer
  private lock: string
  private closed = false
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new PersonalError('INVALID_CONFIGURATION')
    chmodSync(root, 0o700)
    this.lock = join(root, 'receiver.lock')
    try {
      const previous = JSON.parse(readFileSync(this.lock, 'utf8'))
      if (!Number.isSafeInteger(previous.pid) || previous.pid < 1) throw new PersonalError('STATE_LOCKED', 409)
      try { process.kill(previous.pid, 0); throw new PersonalError('STATE_LOCKED', 409) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
      unlinkSync(this.lock)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const fd = openSync(this.lock, 'wx', 0o600)
    writeFileSync(fd, JSON.stringify({ pid: process.pid }))
    closeSync(fd)
    try {
      const file = join(root, 'receipts.sqlite')
      try {
        const stat = lstatSync(file)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new PersonalError('INVALID_CONFIGURATION')
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      this.db = new DatabaseSync(file)
      chmodSync(file, 0o600)
      this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, binding TEXT NOT NULL, capabilities TEXT NOT NULL, revision INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, owner TEXT NOT NULL, source TEXT NOT NULL, workspace TEXT NOT NULL,
          payload_hash TEXT NOT NULL, state TEXT NOT NULL, result TEXT, code TEXT);
        CREATE TABLE IF NOT EXISTS confirmations (id TEXT PRIMARY KEY, binding TEXT NOT NULL, expires INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS trash (id TEXT PRIMARY KEY, owner TEXT NOT NULL, workspace TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL,
          operation_id TEXT NOT NULL, restored INTEGER NOT NULL DEFAULT 0);
        UPDATE operations SET state='unknown' WHERE state='pending';`)
      let key = this.db.prepare('SELECT value FROM meta WHERE key=?').get('cursorKey') as { value: string } | undefined
      if (!key) {
        key = { value: randomBytes(32).toString('hex') }
        this.db.prepare('INSERT INTO meta VALUES (?,?)').run('cursorKey', key.value)
      }
      this.cursorKey = Buffer.from(key.value, 'hex')
    } catch (error) { unlinkSync(this.lock); throw error }
  }
  reserve(id: string, owner: string, source: string, workspace: string, hash: string): void {
    const count = this.db.prepare('SELECT count(*) AS n FROM operations').get() as { n: number }
    if (count.n >= limits.maxOperations) throw new PersonalError('RECEIPT_CAPACITY', 409)
    this.db.prepare('INSERT INTO operations (id,owner,source,workspace,payload_hash,state) VALUES (?,?,?,?,?,?)').run(id, owner, source, workspace, hash, 'pending')
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
    unlinkSync(this.lock)
  }
}
