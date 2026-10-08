import { constants, lstatSync, realpathSync, openSync, fstatSync, readSync, closeSync, type Stats } from 'node:fs'
import { join, relative, sep, isAbsolute } from 'node:path'
import { PersonalError, limits, sha256 } from './protocol'

export interface RootBinding { root: string; dev: number; ino: number }
const identity = (stat: Stats, binding: { dev: number; ino: number }) => stat.dev === binding.dev && stat.ino === binding.ino
export function bindRoot(input: string): RootBinding {
  const stat = lstatSync(input)
  if (!isAbsolute(input) || !stat.isDirectory() || stat.isSymbolicLink()) throw new PersonalError('INVALID_CONFIGURATION')
  const root = realpathSync(input)
  return { root, dev: stat.dev, ino: stat.ino }
}
export function assertRoot(binding: RootBinding): void {
  const stat = lstatSync(binding.root)
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
export function resolveFile(binding: RootBinding, path: string, allowMissing = false): string {
  validatePath(path)
  assertRoot(binding)
  const parts = path.split('/')
  let current = binding.root
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i])
    let stat: Stats
    try { stat = lstatSync(current) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && allowMissing && i === parts.length - 1) return current
      throw new PersonalError('NOT_FOUND', 404)
    }
    if (stat.isSymbolicLink() || !contained(binding.root, realpathSync(current))) throw new PersonalError('UNSAFE_PATH')
    if (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) throw new PersonalError('UNSAFE_PATH')
  }
  return current
}
export function inspectText(bytes: Buffer): string {
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new PersonalError('UNSUPPORTED_FILE') }
  if (text.includes('\0')) throw new PersonalError('UNSUPPORTED_FILE')
  if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})|(?:api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token)\s*["']?\s*[:=]\s*["']?[^\s"']{6,}/i.test(text)) throw new PersonalError('SENSITIVE_FILE', 403)
  return text
}
export function readRegular(binding: RootBinding, path: string): { bytes: Buffer; text: string; hash: string; stat: Stats } {
  const file = resolveFile(binding, path)
  const before = lstatSync(file)
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || !identity(stat, before)) throw new PersonalError('UNSAFE_PATH')
    if (stat.size > limits.maxFileBytes) throw new PersonalError('LIMIT_EXCEEDED', 413)
    const buffer = Buffer.alloc(limits.maxFileBytes + 1)
    let count = 0
    while (count < buffer.length) {
      const read = readSync(fd, buffer, count, buffer.length - count, count)
      if (!read) break
      count += read
    }
    const after = fstatSync(fd)
    if (count > limits.maxFileBytes) throw new PersonalError('LIMIT_EXCEEDED', 413)
    if (after.size !== count || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs ||
        !identity(lstatSync(resolveFile(binding, path)), stat)) throw new PersonalError('FILE_CHANGED', 409)
    const bytes = buffer.subarray(0, count)
    return { bytes, text: inspectText(bytes), hash: sha256(bytes), stat }
  } finally { closeSync(fd) }
}
