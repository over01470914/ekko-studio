import { mkdir, readFile, rename, rm, open, chmod } from 'fs/promises'
import { randomUUID } from 'crypto'
import { dirname, relative, resolve } from 'path'
import { serviceCenterHost } from './host'

// Module-private serialized atomic file writes. No dependency on Studio's global SafeFileStore.
let pending: Promise<unknown> = Promise.resolve()
export function dataPath(...parts: string[]): string {
  return resolve(serviceCenterHost().dataRoot, ...parts)
}
async function read(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
async function write(path: string, value: string | undefined): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700)
  const syncDirectory = async () => {
    const handle = await open(dir, 'r')
    try { await handle.sync() } finally { await handle.close() }
  }
  if (value === undefined) { await rm(path, { force: true }); await syncDirectory(); return }
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    const handle = await open(temp, 'wx', 0o600)
    try { await handle.writeFile(value, 'utf8'); await handle.sync() } finally { await handle.close() }
    await rename(temp, path)
    await syncDirectory()
  } finally { await rm(temp, { force: true }) }
}
export async function updateFiles<T>(paths: string[], change: (raw: Record<string, string | undefined>) => { files: Record<string, string | undefined>; result: T }): Promise<T> {
  const root = resolve(serviceCenterHost().dataRoot)
  const locked = [...new Set(paths.map(path => resolve(path)))].sort()
  if (!locked.length || locked.some(path => relative(root, path).startsWith('..') || path === root)) throw new Error('Invalid Service Center storage path')
  const task = async () => {
    const current: Record<string, string | undefined> = {}
    for (const path of locked) current[path] = await read(path)
    const { files, result } = change(Object.freeze({ ...current }))
    if (Object.keys(files).some(path => !locked.includes(resolve(path)))) throw new Error('Unlocked Service Center storage path')
    const written: string[] = []
    try {
      for (const path of locked) {
        if (!Object.hasOwn(files, path)) continue
        written.push(path)
        await write(path, files[path])
      }
    } catch (error) {
      for (const path of written.reverse()) {
        if (await read(path) !== current[path]) await write(path, current[path])
      }
      throw error
    }
    return result
  }
  const result = pending.then(task, task)
  pending = result.then(() => undefined, () => undefined)
  return result
}
