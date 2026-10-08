#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const upstream = '942bb78fa2e3722fe14e6778b0ff21d50662fa27'
const moduleRoots = [
  'packages/client/src/modules/studio-extensions/service-center/',
  'packages/server/src/modules/studio/extensions/service-center/',
  'packages/server/src/modules/studio/extensions/personal-agent/',
  'packages/personal-assistant/',
]
const shared = new Set([
  'packages/client/src/main.ts', 'packages/client/src/App.vue',
  'packages/client/src/components/layout/StudioNavigationRail.vue',
  'packages/server/src/bootstrap/routes.ts', 'packages/server/src/bootstrap/studio-extensions.ts',
  'packages/client/src/bootstrap/studio-extensions.ts',
  'packages/client/src/modules/studio-extensions/registry.ts',
  'packages/server/src/modules/studio/extensions/registry.ts',
  'scripts/generate-openapi.mjs', 'scripts/studio-extension-openapi.mjs',
  'scripts/check-studio-extension-boundary.mjs', 'docs/openapi.json',
  'docs/harness/studio-extensions.md',
  'package.json',
  'scripts/build-server.mjs',
  'scripts/personal-lab.py', 'scripts/personal-lab-seed.ts',
  'scripts/validate-personal-agent-catalog.py',
  'scripts/personal-agent-build.mjs', 'scripts/personal-agent-acceptance.mjs',
  'scripts/personal-agent-fd-probe.mjs',
])
const tests = /^(tests\/(client\/(service-center|studio-extension-registry|i18n-coverage)\.test\.ts|server\/(service-center|service-center-health|studio-extension-registry|studio-extension-openapi|studio-extension-boundary)\.test\.ts|e2e\/(service-center|service-center-live|fixtures)\.(spec\.)?ts|helpers\/service-center-preview\.ts))$/
export function allowedChangedPath(path) {
  return moduleRoots.some(root => path.startsWith(root)) || path.startsWith('docs/service-center/') ||
    path.startsWith('docs/personal-agent/') || /^tests\/personal-assistant\/[a-z-]+\.test\.ts$/.test(path) ||
    /^tests\/server\/personal-agent[a-z-]*\.test\.ts$/.test(path) || shared.has(path) || tests.test(path)
}
export function moduleImportViolations(path, source) {
  const root = moduleRoots.find(item => path.startsWith(item))
  if (!root) return []
  const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"`]+)['"]/g)]
  return imports.map(match => match[1]).filter(specifier => {
    if (specifier.startsWith('@/') || specifier.startsWith('modules/')) return true
    if (!specifier.startsWith('.')) return false
    const target = relative('.', resolve(dirname(path), specifier))
    const registry = `${dirname(root.slice(0, -1))}/registry`
    const personalPublic = root.endsWith('/personal-agent/') && target === 'packages/personal-assistant/src'
    return !target.startsWith(root) && target !== registry && !personalPublic
  }).map(specifier => `${path}: forbidden import ${specifier}`)
}
const run = args => execFileSync('git', args, { encoding: 'utf8' }).trim()
export function checkRepository() {
  run(['merge-base', '--is-ancestor', upstream, 'HEAD'])
  const tracked = run(['diff', '--name-only', upstream, '--']).split('\n').filter(Boolean)
  const untracked = run(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)
  const changed = [...new Set([...tracked, ...untracked])].sort()
  const unexpected = changed.filter(path => !allowedChangedPath(path))
  if (unexpected.length) throw new Error(`Out-of-bound changes: ${unexpected.join(', ')}`)
  const equal = ['packages/client/src/router/index.ts', 'packages/client/src/components/layout/AppSidebar.vue',
    'packages/server/src/modules/studio/public/safe-file-store.ts',
    ...run(['ls-tree', '-r', '--name-only', upstream, '--', 'packages/client/src/i18n/locales/']).split('\n').filter(path => path.endsWith('.ts'))]
  if (equal.length !== 14) throw new Error(`Expected router, sidebar, SafeFileStore and 11 locale files; got ${equal.length}`)
  const mismatches = equal.filter(path => existsSync(path) &&
    readFileSync(path).toString('utf8') !== execFileSync('git', ['show', `${upstream}:${path}`], { encoding: 'utf8' }))
  if (mismatches.length) throw new Error(`Upstream equality failed: ${mismatches.join(', ')}`)
  if (JSON.parse(readFileSync('package.json', 'utf8')).version !== '0.7.31') throw new Error('Root version differs from upstream 0.7.31')
  if (JSON.parse(readFileSync('packages/server/src/modules/studio/extensions/service-center/manifest.schema.json', 'utf8')).properties.schemaVersion.const !== 1) throw new Error('Manifest schemaVersion changed')
  const violations = changed.filter(path => moduleRoots.some(root => path.startsWith(root)) && existsSync(path))
    .flatMap(path => moduleImportViolations(path, readFileSync(path, 'utf8')))
  if (violations.length) throw new Error(violations.join('\n'))
  for (const path of changed.filter(path => existsSync(path))) {
    if (/^(<<<<<<< |>>>>>>> |=======$)/m.test(readFileSync(path, 'utf8'))) throw new Error(`Conflict marker in ${path}`)
  }
  return { changed: changed.length, upstreamEqual: equal.length, moduleSourcesChecked: changed.filter(path => moduleRoots.some(root => path.startsWith(root)) && existsSync(path)).length }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log('Studio extension boundary:', checkRepository()) }
  catch (error) { console.error(error); process.exitCode = 1 }
}
