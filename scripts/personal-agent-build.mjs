#!/usr/bin/env node
import * as esbuild from 'esbuild'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { chmodSync, mkdirSync, rmSync, copyFileSync } from 'fs'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(rootDir, 'dist/personal-assistant')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
await esbuild.build({
  entryPoints: {
    index: resolve(rootDir, 'packages/personal-assistant/src/index.ts'),
    node: resolve(rootDir, 'packages/personal-assistant/src/node.ts'),
    mcp: resolve(rootDir, 'packages/personal-assistant/src/mcp.ts'),
  },
  bundle: true, platform: 'node', target: 'node23', format: 'cjs', outdir: outDir,
  external: ['node:sqlite'], sourcemap: true, minify: true, logLevel: 'info',
})
copyFileSync(resolve(rootDir, 'packages/personal-assistant/protocol.schema.json'), resolve(outDir, 'protocol.schema.json'))
chmodSync(resolve(outDir, 'node.js'), 0o755)
chmodSync(resolve(outDir, 'mcp.js'), 0o755)