import { defineConfig } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export default defineConfig({ testDir: resolve(root, 'tests/e2e'), testMatch: 'personal-agent-native.spec.ts', fullyParallel: false, workers: 1, retries: 0, timeout: 180000, reporter: [['list']], outputDir: resolve(root, 'dist/personal-lab/playwright-results') })
