import { constants, lstatSync, realpathSync, openSync, fstatSync, readSync, closeSync, type BigIntStats } from 'node:fs'
import { relative, sep, isAbsolute } from 'node:path'
import { PersonalError, limits, sha256 } from './protocol'
import { posix } from './posix'

export interface RootBinding { root: string; dev: bigint; ino: bigint }
const identity = (stat: Pick<BigIntStats, 'dev' | 'ino'>, binding: { dev: bigint; ino: bigint }) => stat.dev === binding.dev && stat.ino === binding.ino
export function bindRoot(input: string): RootBinding {
  const stat = lstatSync(input, { bigint: true })
  if (!isAbsolute(input) || !stat.isDirectory() || stat.isSymbolicLink()) throw new PersonalError('INVALID_CONFIGURATION')
  // The existing installation receipt uses JSON numbers. Do not migrate or
  // silently round that identity: unsupported root IDs fail closed instead.
  if (!Number.isSafeInteger(Number(stat.dev)) || !Number.isSafeInteger(Number(stat.ino))) throw new PersonalError('PLATFORM_UNVERIFIED', 503)
  const root = realpathSync(input)
  return { root, dev: stat.dev, ino: stat.ino }
}
export function assertRoot(binding: RootBinding): void {
  const stat = lstatSync(binding.root, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink() || !identity(stat, binding) || realpathSync(binding.root) !== binding.root) throw new PersonalError('ROOT_CHANGED', 409)
}
export function contained(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}
export function validatePath(path: string): void {
  if (path.length > 512 || !path || /[\\:%\x00-\x1f\x7f]/.test(path) || isAbsolute(path) || path.normalize('NFC') !== path ||
      path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new PersonalError('UNSAFE_PATH')
  if (path.split('/').some(part => part.startsWith('.') || /^(id_rsa|id_ed25519|credentials|secrets?|tokens?|passwords?)(\.|$)/i.test(part) || /\.(pem|key|p12|pfx|sqlite|db)$/i.test(part))) throw new PersonalError('SENSITIVE_FILE', 403)
}
export interface DirectoryAnchor {
  fd: number
  assertCurrent(): void
  close(): void
}
export function anchorDirectory(binding: RootBinding, path = ''): DirectoryAnchor {
  if (path) validatePath(path)
  const native = posix()
  const descriptors: number[] = []
  const snapshots: BigIntStats[] = []
  try {
    assertRoot(binding)
    descriptors.push(openSync(binding.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW))
    const root = fstatSync(descriptors[0], { bigint: true })
    if (!root.isDirectory() || !identity(root, binding)) throw new PersonalError('ROOT_CHANGED', 409)
    snapshots.push(root)
    for (const part of path ? path.split('/') : []) {
      const before = native.statAt(descriptors[descriptors.length - 1], part)
      if (!before.directory || before.symlink) throw new PersonalError('UNSAFE_PATH')
      const fd = native.openAt(descriptors[descriptors.length - 1], part, constants.O_RDONLY | constants.O_DIRECTORY)
      descriptors.push(fd)
      const stat = fstatSync(fd, { bigint: true })
      if (!stat.isDirectory() || !identity(stat, before)) throw new PersonalError('UNSAFE_PATH')
      snapshots.push(stat)
    }
    let closed = false
    return { fd: descriptors[descriptors.length - 1],
      assertCurrent() {
        // Identity rechecks detect a detached/replaced chain. They supplement
        // (never replace) the dirfd-relative syscalls that actually contain IO.
        const current = anchorDirectory(binding, path)
        try { if (!identity(fstatSync(current.fd, { bigint: true }), snapshots[snapshots.length - 1])) throw new PersonalError('ROOT_CHANGED', 409) }
        finally { current.close() }
      },
      close() { if (!closed) { closed = true; descriptors.reverse().forEach(fd => closeSync(fd)) } },
    }
  } catch (error) {
    descriptors.reverse().forEach(fd => closeSync(fd))
    if (error instanceof PersonalError) throw error
    throw new PersonalError((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'NOT_FOUND' : 'UNSAFE_PATH', 409)
  }
}
export function anchorFile(binding: RootBinding, path: string) {
  validatePath(path)
  const parts = path.split('/')
  const name = parts.pop()!
  return { directory: anchorDirectory(binding, parts.join('/')), name }
}
export function inspectText(bytes: Buffer): string {
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new PersonalError('UNSUPPORTED_FILE') }
  if (text.includes('\0')) throw new PersonalError('UNSUPPORTED_FILE')
  if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})|(?:api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token)\s*["']?\s*[:=]\s*["']?[^\s"']{6,}/i.test(text)) throw new PersonalError('SENSITIVE_FILE', 403)
  return text
}
export function readRegular(binding: RootBinding, path: string): { bytes: Buffer; text: string; hash: string; stat: BigIntStats } {
  const { directory, name } = anchorFile(binding, path)
  try { return readAnchored(directory, name) } finally { directory.close() }
}
export function readAnchored(directory: DirectoryAnchor, name: string): { bytes: Buffer; text: string; hash: string; stat: BigIntStats } {
  const native = posix()
  directory.assertCurrent()
  let before
  try { before = native.statAt(directory.fd, name) }
  catch { throw new PersonalError('NOT_FOUND', 404) }
  if (!before.file || before.symlink || before.nlink !== 1) throw new PersonalError('UNSAFE_PATH')
  let fd: number
  try { fd = native.openAt(directory.fd, name, constants.O_RDONLY) }
  catch { throw new PersonalError('UNSAFE_PATH') }
  try {
    const stat = fstatSync(fd, { bigint: true })
    if (!stat.isFile() || stat.nlink !== 1n || !identity(stat, before)) throw new PersonalError('UNSAFE_PATH')
    if (stat.size > limits.maxFileBytes) throw new PersonalError('LIMIT_EXCEEDED', 413)
    const buffer = Buffer.alloc(limits.maxFileBytes + 1)
    let count = 0
    while (count < buffer.length) {
      const read = readSync(fd, buffer, count, buffer.length - count, count)
      if (!read) break
      count += read
    }
    const after = fstatSync(fd, { bigint: true })
    if (count > limits.maxFileBytes) throw new PersonalError('LIMIT_EXCEEDED', 413)
    if (after.size !== BigInt(count) || stat.size !== after.size || stat.mtimeNs !== after.mtimeNs || stat.ctimeNs !== after.ctimeNs ||
        !identity(native.statAt(directory.fd, name), stat)) throw new PersonalError('FILE_CHANGED', 409)
    directory.assertCurrent()
    const bytes = buffer.subarray(0, count)
    return { bytes, text: inspectText(bytes), hash: sha256(bytes), stat }
  } finally { closeSync(fd) }
}
