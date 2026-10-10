import { build as bundle } from 'esbuild'
import { build as viteBuild } from 'vite'
import vue from '@vitejs/plugin-vue'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist/personal-lab'); mkdirSync(out, { recursive: true })
const result = await bundle({ entryPoints: [join(root, 'packages/server/src/bootstrap/personal-gateway.ts')], outfile: join(out, 'personal-gateway.cjs'), bundle: true, platform: 'node', target: 'node22', format: 'cjs', metafile: true, sourcemap: false, logLevel: 'info' })
const inputs = Object.keys(result.metafile.inputs)
if (inputs.some(path => /modules\/(hermes|ekko|coding-agents)\/|bootstrap\/(http|runtime)|packages\/ekko-agent/.test(path))) throw new Error('Personal gateway imports a forbidden local inference runtime')
writeFileSync(join(out, 'gateway-graph.json'), JSON.stringify({ version: 1, localAgent: false, localBridge: false, inputs }, null, 2))
const native = join(root, 'packages/personal-assistant/dist/personal-fs.node')
if (!existsSync(native)) throw new Error('Build the accepted PA01 native adapter first')
cpSync(native, join(out, 'personal-fs.node'))
await viteBuild({ configFile: false, root, publicDir: join(root, 'packages/client/public'), plugins: [vue()], resolve: { alias: { '@': join(root, 'packages/client/src') } }, build: { outDir: join(out, 'client'), emptyOutDir: true, target: 'es2022', rollupOptions: { input: join(root, 'personal.html') } } })
execFileSync('npm', ['--prefix', join(root, 'packages/desktop'), 'run', 'build:main'], { cwd: root, stdio: 'inherit' })
const stage = join(out, 'app'); rmSync(stage, { recursive: true, force: true }); mkdirSync(stage, { recursive: true })
for (const file of ['main/personal-entry.js', 'main/personal-lab-identity.js', 'preload/personal.js']) { mkdirSync(dirname(join(stage, 'dist', file)), { recursive: true }); cpSync(join(root, 'packages/desktop/dist', file), join(stage, 'dist', file)) }
writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'ekko-personal-lab', version: '0.7.31-personal.1', main: 'dist/main/personal-entry.js', private: true, description: 'Local trusted client gateway to the same central assistant', author: 'Ekko Studio Contributors', license: 'BSL-1.1' }, null, 2))
const electronVersion = JSON.parse(readFileSync(join(root, 'packages/desktop/node_modules/electron/package.json'), 'utf8')).version
const config = { appId: 'com.ekko.personal-lab', productName: 'Ekko Personal Lab', electronVersion, asar: true, directories: { app: stage, output: join(out, 'package') },
  files: ['dist/**/*.js', 'package.json'], extraResources: [{ from: join(out, 'personal-gateway.cjs'), to: 'personal-gateway.cjs' }, { from: join(out, 'personal-fs.node'), to: 'personal-fs.node' }, { from: join(out, 'client'), to: 'client' }, { from: join(out, 'gateway-graph.json'), to: 'gateway-graph.json' }],
  mac: { identity: null, hardenedRuntime: false, target: ['zip'], category: 'public.app-category.productivity' }, publish: null, artifactName: 'Ekko-Personal-Lab-${version}-${arch}.${ext}' }
writeFileSync(join(out, 'builder.json'), JSON.stringify(config, null, 2))
if (process.argv.includes('--package')) {
  if (process.platform !== 'darwin') throw new Error('macOS artifact validation requires macOS')
  execFileSync(process.execPath, [join(root, 'packages/desktop/node_modules/electron-builder/out/cli/cli.js'), '--config', join(out, 'builder.json'), '--mac', '--' + process.arch, '--publish', 'never'], { cwd: stage, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } })
}
console.log(JSON.stringify({ gateway: 'personal-only', inputs: inputs.length, stage, version: '0.7.31-personal.1', publish: false }))
