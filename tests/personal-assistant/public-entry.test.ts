import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const repo = resolve(__dirname, '../..')
const packageDir = join(repo, 'packages/personal-assistant')
const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })))
beforeAll(() => {
  execFileSync(process.execPath, [join(repo, 'scripts/personal-agent-build.mjs')], { cwd: repo, stdio: 'pipe' })
}, 60_000)

// A fresh Node consumer uses only package main/exports, never TS source or the
// repository's standalone bundle. Relocation also proves companion resolution.
const consumer = `
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const {createRequire} = require('node:module');
  const {randomBytes, randomUUID} = require('node:crypto');
  const [packageDir, base, entry, noNative] = process.argv.slice(1);
  const packageRequire = createRequire(path.join(packageDir, 'package.json'));
  const manifest = packageRequire('./package.json');
  const engine = entry === 'main' ? require(packageDir) : packageRequire(manifest.name);
  const schema = packageRequire(manifest.name + '/protocol.schema.json');
  assert.deepEqual(engine.protocolSchema, schema);
  assert.equal(manifest.version, '0.1.0');
  const root = path.join(base, 'files');
  fs.mkdirSync(root, {mode: 0o700});
  fs.writeFileSync(path.join(root, 'ordinary.txt'), 'bounded 真實內容');
  const token = randomBytes(32).toString('hex');
  const config = {stateRoot: path.join(base, 'state'), deviceId: 'entry-device', hostname: 'entry-host',
    workspaces: [{id: 'entry-workspace', ownerId: 'entry-owner', label: 'Private fixture', root}],
    approvals: [{id: 'entry-grant', ownerId: 'entry-owner', sourceDeviceId: 'entry-sender',
      sourceOrigin: 'http://127.0.0.1:41001', workspaceId: 'entry-workspace', token,
      capabilities: ['search', 'read', 'write', 'delete']}]};
  if (noNative === 'yes') {
    assert.throws(() => new engine.PersonalReceiver(config), {code: 'PLATFORM_UNVERIFIED', status: 503});
    assert.equal(fs.existsSync(config.stateRoot), false);
    process.stdout.write(JSON.stringify({failClosedBeforeState: true}));
  } else {
    let receiver = new engine.PersonalReceiver(config);
    let peer = receiver.authenticate(token, 'http://127.0.0.1:41001');
    const request = (action, extra = {}) => ({version: 1, operationId: randomUUID(), deviceId: config.deviceId,
      workspaceId: 'entry-workspace', grantRevision: 1, action, ...extra});
    const results = [];
    const run = req => {
      const response = engine.validateResponse(receiver.execute(peer, req));
      assert.equal(response.target.deviceId, config.deviceId);
      results.push(response);
      return response;
    };
    const status = op => run(request('status', {operationId: op.operationId})).data.state;
    try {
      assert.equal(run(request('search', {query: '真實', mode: 'content', limit: 1})).data.items[0].path, 'ordinary.txt');
      assert.equal(run(request('read', {path: 'ordinary.txt'})).data.text, 'bounded 真實內容');
      const create = request('write', {path: 'created.txt', mode: 'create', content: 'public entry write'});
      const created = run(create);
      assert.equal(created.data.sha256, engine.sha256(fs.readFileSync(path.join(root, create.path))));
      assert.equal(status(create), 'completed');
      assert.deepEqual(run(create), created);
      const overwrite = request('write', {path: create.path, mode: 'overwrite', content: 'public entry overwrite', expectedSha256: created.data.sha256});
      const changed = run(overwrite);
      assert.equal(fs.readFileSync(path.join(root, create.path), 'utf8'), overwrite.content);
      assert.equal(changed.data.sha256, engine.sha256(fs.readFileSync(path.join(root, create.path))));
      assert.equal(status(overwrite), 'completed');
      assert.throws(() => run({...overwrite, operationId: randomUUID(), expectedSha256: '0'.repeat(64)}), {code: 'CONFLICT'});
      const del = request('delete', {path: create.path, expectedSha256: changed.data.sha256});
      del.confirmationId = receiver.confirmDelete('entry-owner', 'entry-sender', del).confirmationId;
      const deleted = run(del);
      assert.equal(fs.existsSync(path.join(root, del.path)), false);
      assert.equal(status(del), 'completed');
      const restored = engine.validateResponse(receiver.restore('entry-owner', deleted.data.receiptId));
      results.push(restored);
      assert.equal(restored.data.sha256, changed.data.sha256);
      assert.equal(fs.readFileSync(path.join(root, del.path), 'utf8'), overwrite.content);
      const uncertain = request('write', {path: 'uncertain.txt', mode: 'create', content: 'must not be retried'});
      receiver.reserveOperation(peer, uncertain);
      receiver.close();
      receiver = new engine.PersonalReceiver(config);
      peer = receiver.authenticate(token, 'http://127.0.0.1:41001');
      assert.equal(status(create), 'completed');
      assert.equal(status(uncertain), 'unknown');
      assert.equal(run(uncertain).outcome, 'unknown');
      assert.equal(fs.existsSync(path.join(root, uncertain.path)), false);
      receiver.setGrant('entry-owner', 'entry-grant', 1, []);
      assert.throws(() => run(request('read', {path: del.path})), {code: 'GRANT_MISMATCH'});
      assert.equal(JSON.stringify(results).includes(token), false);
      assert.equal(JSON.stringify(results).includes(root), false);
      process.stdout.write(JSON.stringify({realReceiver: true, schemaExport: true, independentDiskReadback: true,
        searchReadCreateOverwriteDeleteStatusRestore: true, unknownNoRedispatch: true, liveRevoke: true}));
    } finally { receiver.close(); }
  }
`

function probe(entry: string, relocated: boolean, noNative = false) {
  const base = mkdtempSync(join(tmpdir(), 'pa-public-entry-'))
  dirs.push(base)
  let target = packageDir
  if (relocated) {
    target = join(base, 'consumer-package')
    mkdirSync(target)
    // No source, parent repo, node_modules or standalone output is copied.
    for (const file of ['package.json', 'protocol.schema.json', 'dist']) cpSync(join(packageDir, file), join(target, file), { recursive: true })
    if (noNative) rmSync(join(target, 'dist/personal-fs.node'))
  }
  const child = spawnSync(process.execPath, ['-e', consumer, target, base, entry, noNative ? 'yes' : 'no'], {
    cwd: base, encoding: 'utf8', timeout: 30_000,
  })
  expect(child.status, child.stderr || child.error?.message).toBe(0)
  return JSON.parse(child.stdout)
}

describe('PA01 declared package entry (real built consumer)', () => {
  it.each([
    { entry: 'main', relocated: false }, { entry: 'export', relocated: false },
    { entry: 'main', relocated: true }, { entry: 'export', relocated: true },
  ])('exercises receiver operations via $entry (relocated=$relocated)', ({ entry, relocated }) => {
    expect(probe(entry, relocated)).toEqual({ realReceiver: true, schemaExport: true,
      independentDiskReadback: true, searchReadCreateOverwriteDeleteStatusRestore: true, unknownNoRedispatch: true, liveRevoke: true })
  })
  it('fails closed before state creation when the public package lacks its native companion', () => {
    expect(probe('export', true, true)).toEqual({ failClosedBeforeState: true })
  })
})
