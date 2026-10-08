import { lstatSync, openSync, constants, fstatSync, readFileSync, closeSync } from 'node:fs'
import { PersonalError, plainJson, limits } from './protocol'

// Explicit operator-owned secret/config file, not a default profile or renderer payload.
export function readPrivateConfig(file: string): Record<string, unknown> {
  const before = lstatSync(file)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || (before.mode & 0o077) ||
      (process.getuid && before.uid !== process.getuid()) || before.size > limits.maxRequestBytes) throw new PersonalError('INVALID_CONFIGURATION')
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (stat.dev !== before.dev || stat.ino !== before.ino || stat.size > limits.maxRequestBytes) throw new PersonalError('INVALID_CONFIGURATION')
    const value = JSON.parse(readFileSync(fd, 'utf8'))
    if (!plainJson(value) || !value || typeof value !== 'object' || Array.isArray(value)) throw new PersonalError('INVALID_CONFIGURATION')
    return value as Record<string, unknown>
  } catch { throw new PersonalError('INVALID_CONFIGURATION') }
  finally { closeSync(fd) }
}
