import { join } from 'node:path'
import type { BigIntStats } from 'node:fs'
import { PersonalError } from './protocol'

export interface EntryStat { dev: bigint; ino: bigint; nlink: number; size: number; file: boolean; directory: boolean; symlink: boolean }
export interface FileRevision { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint; bytes: Buffer }
export function fileRevision(stat: BigIntStats, bytes: Buffer): FileRevision {
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs, bytes }
}
interface Posix {
  abiVersion: number
  openAt(fd: number, name: string, flags: number): number
  statAt(fd: number, name: string): EntryStat
  linkAt(from: number, source: string, to: number, target: string, sourceRevision: FileRevision, targetRevision: null): void
  renameAt(from: number, source: string, to: number, target: string, sourceRevision: FileRevision, targetRevision: FileRevision | null): void
  unlinkAt(fd: number, name: string): void
  entries(fd: number, max: number): { names: string[]; hasMore: boolean }
}
let loaded: Posix | undefined
export function posix(): Posix {
  if (loaded) return loaded
  if (!['darwin', 'linux'].includes(process.platform)) throw new PersonalError('PLATFORM_UNVERIFIED', 503)
  for (const path of [join(__dirname, 'personal-fs.node'), join(__dirname, '../dist/personal-fs.node')]) {
    try {
      const candidate = require(path) as Posix
      if (candidate.abiVersion === 2) { loaded = candidate; return candidate }
    } catch {}
  }
  // Loading is lazy: off/unconfigured Studio needs no native module. A configured
  // receiver must never fall back to race-prone absolute-path operations.
  throw new PersonalError('PLATFORM_UNVERIFIED', 503)
}
