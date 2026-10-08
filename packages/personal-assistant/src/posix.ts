import { join } from 'node:path'
import { PersonalError } from './protocol'

export interface EntryStat { dev: bigint; ino: bigint; nlink: number; size: number; file: boolean; directory: boolean; symlink: boolean }
interface Posix {
  openAt(fd: number, name: string, flags: number): number
  statAt(fd: number, name: string): EntryStat
  linkAt(from: number, source: string, to: number, target: string): void
  renameAt(from: number, source: string, to: number, target: string): void
  unlinkAt(fd: number, name: string): void
  entries(fd: number, max: number): { names: string[]; hasMore: boolean }
}
let loaded: Posix | undefined
export function posix(): Posix {
  if (loaded) return loaded
  if (!['darwin', 'linux'].includes(process.platform)) throw new PersonalError('PLATFORM_UNVERIFIED', 503)
  for (const path of [join(__dirname, 'personal-fs.node'), join(__dirname, '../dist/personal-fs.node')]) {
    try { loaded = require(path) as Posix; return loaded } catch {}
  }
  // Loading is lazy: off/unconfigured Studio needs no native module. A configured
  // receiver must never fall back to race-prone absolute-path operations.
  throw new PersonalError('PLATFORM_UNVERIFIED', 503)
}
