#!/usr/bin/env node
import * as esbuild from 'esbuild'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { chmodSync, mkdirSync, rmSync, copyFileSync } from 'fs'
import { buildPersonalNative } from './personal-agent-native.mjs'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(rootDir, 'dist/personal-assistant')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
const nativeDir = resolve(rootDir, 'packages/personal-assistant/dist')
if (buildPersonalNative(nativeDir)) copyFileSync(resolve(nativeDir, 'personal-fs.node'), resolve(outDir, 'personal-fs.node'))
await esbuild.build({
  entryPoints: {
    index: resolve(rootDir, 'packages/personal-assistant/src/index.ts'),
    node: resolve(rootDir, 'packages/personal-assistant/src/node.ts'),
    mcp: resolve(rootDir, 'packages/personal-assistant/src/mcp.ts'),
  },
  bundle: true, platform: 'node', target: 'node23', format: 'cjs', outdir: outDir,
  external: ['node:sqlite'], sourcemap: true, minify: true, logLevel: 'info',
})
// Build the declared public main/export inside its package, beside the native
// companion. The standalone node/MCP artifacts are separate consumers.
await esbuild.build({
  entryPoints: [resolve(rootDir, 'packages/personal-assistant/src/index.ts')],
  bundle: true, platform: 'node', target: 'node23', format: 'cjs',
  outfile: resolve(nativeDir, 'index.cjs'), external: ['node:sqlite'],
  sourcemap: true, minify: true, logLevel: 'info',
})
copyFileSync(resolve(rootDir, 'packages/personal-assistant/protocol.schema.json'), resolve(outDir, 'protocol.schema.json'))
chmodSync(resolve(outDir, 'node.js'), 0o755)
chmodSync(resolve(outDir, 'mcp.js'), 0o755)