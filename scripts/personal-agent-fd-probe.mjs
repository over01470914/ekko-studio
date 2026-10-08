// Disposable probe: verify descriptor-relative access on this host, not Windows.
import { mkdtempSync, mkdirSync, openSync, constants, writeFileSync, readFileSync, renameSync, closeSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = mkdtempSync(join(tmpdir(), 'pa-fd-probe-'))
try {
  mkdirSync(join(root, 'parent'))
  const fd = openSync(join(root, 'parent'), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    writeFileSync(`/dev/fd/${fd}/test.txt`, 'anchored')
    renameSync(join(root, 'parent'), join(root, 'moved'))
    console.log(JSON.stringify({ platform: process.platform, descriptorRelativeRead: readFileSync(`/dev/fd/${fd}/test.txt`, 'utf8') === 'anchored' }))
  } finally { closeSync(fd) }
} finally { rmSync(root, { recursive: true, force: true }) }
