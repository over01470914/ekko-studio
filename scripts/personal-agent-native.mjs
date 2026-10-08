#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export function buildPersonalNative(outDir) {
  if (!['darwin', 'linux'].includes(process.platform)) return false
  const includes = [process.env.PERSONAL_NODE_INCLUDE, resolve(dirname(process.execPath), '../include/node'),
    resolve(homedir(), 'Library/Caches/node-gyp', process.versions.node, 'include/node'),
    resolve(homedir(), '.cache/node-gyp', process.versions.node, 'include/node'), '/usr/include/node'].filter(Boolean)
  const include = includes.find(path => existsSync(resolve(path, 'node_api.h')))
  if (!include) throw new Error('PERSONAL_NATIVE_NODE_HEADERS_MISSING: set PERSONAL_NODE_INCLUDE to installed Node N-API headers')
  mkdirSync(outDir, { recursive: true })
  const flags = process.platform === 'darwin' ? ['-bundle', '-undefined', 'dynamic_lookup'] : ['-shared', '-fPIC']
  const result = spawnSync(process.env.CC || 'cc', ['-std=c11', '-D_GNU_SOURCE', '-O2', '-Wall', '-Wextra', '-Werror',
    ...flags, '-I', include, resolve(root, 'packages/personal-assistant/native/posix.c'), '-o', resolve(outDir, 'personal-fs.node')], { stdio: 'inherit' })
  if (result.error || result.status !== 0) throw new Error('PERSONAL_NATIVE_BUILD_FAILED')
  return true
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildPersonalNative(resolve(root, 'packages/personal-assistant/dist'))
}
