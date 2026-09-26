const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { createScriptStorage, createScriptGate } = require('../electron/script-storage.cjs');
const { createScriptStore } = require('../electron/script-files.cjs');
const { ScriptRunner } = require('../electron/script-runner.cjs');

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poke-storage-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const userData = path.join(directory, 'profile'), target = path.join(directory, 'new-library'), gate = createScriptGate();
  await fs.mkdir(target);
  const storage = await createScriptStorage({ userData, gate, ...options });
  const original = storage.getRoot();
  await fs.mkdir(path.join(original, 'BDSP/ImgLabel'), { recursive: true });
  await fs.writeFile(path.join(original, 'BDSP/test.txt'), 'A 1\n');
  await fs.writeFile(path.join(original, 'BDSP/ImgLabel/test.IL'), 'personal label');
  await fs.writeFile(path.join(original, 'BDSP/.rng-package.json'), 'installed record');
  return { directory, userData, target, original, storage, gate };
}
test('migration copies and verifies the entire library, persists the root and keeps the source', async t => {
  const f = await fixture(t);
  const store = createScriptStore(f.storage.getRoot, { serialize: f.gate.run });
  const runner = new ScriptRunner({ controller: new EventEmitter(), rootDirectory: f.storage.getRoot, emit() {} });
  const plan = await f.storage.prepare(f.target);
  assert.equal(plan.files, 3); assert.equal(f.storage.getRoot(), f.original);
  await f.storage.migrate(plan.token);
  assert.equal(f.storage.getRoot(), f.target);
  for (const name of ['test.txt', 'ImgLabel/test.IL', '.rng-package.json']) {
    assert.deepEqual(await fs.readFile(path.join(f.target, 'BDSP', name)), await fs.readFile(path.join(f.original, 'BDSP', name)));
  }
  assert.equal((await store.list()).rootPath, f.target);
  assert.equal((await runner.resolveScript('BDSP/test.txt')).absolute, path.join(f.target, 'BDSP/test.txt'));
  const file = (await store.list()).files[0];
  await store.save({ path: file.path, name: file.name, body: 'B 1\n', expectedRevision: file.revision });
  assert.equal(await fs.readFile(path.join(f.original, 'BDSP/test.txt'), 'utf8'), 'A 1\n');
  assert.equal((await createScriptStorage({ userData: f.userData })).getRoot(), f.target);
});
test('migration rejects overlaps, occupied destinations, and ancestor junctions', async t => {
  const f = await fixture(t);
  for (const target of [f.original, f.directory, path.join(f.original, 'nested'), path.parse(f.target).root]) await assert.rejects(f.storage.prepare(target));
  await fs.writeFile(path.join(f.target, 'personal.txt'), 'keep');
  await assert.rejects(f.storage.prepare(f.target), /空文件夹/);
  const alias = path.join(f.directory, 'alias');
  await fs.symlink(f.target, alias, 'junction');
  await fs.mkdir(path.join(f.target, 'child'));
  await assert.rejects(f.storage.prepare(path.join(alias, 'child')), /链接/);
});
test('stale previews and active execution cannot switch the library', async t => {
  let busy = false;
  const f = await fixture(t, { isBusy: () => busy });
  let plan = await f.storage.prepare(f.target);
  await fs.writeFile(path.join(f.original, 'new.txt'), 'new');
  await assert.rejects(f.storage.migrate(plan.token), /变化/);
  plan = await f.storage.prepare(f.target); busy = true;
  await assert.rejects(f.storage.migrate(plan.token), /停止/);
  assert.equal(f.storage.getRoot(), f.original); assert.equal(f.gate.busy, false);
  busy = false;
  await fs.writeFile(path.join(f.target, 'external.txt'), 'keep');
  await assert.rejects(f.storage.migrate(plan.token), /空文件夹/);
});
test('failed persistence keeps the old root and the copied files recoverable', async t => {
  const f = await fixture(t, { persist: async () => { throw Error('disk full'); } });
  const plan = await f.storage.prepare(f.target);
  await assert.rejects(f.storage.migrate(plan.token), /disk full/);
  assert.equal(f.storage.getRoot(), f.original);
  assert.equal(await fs.readFile(path.join(f.target, 'BDSP/test.txt'), 'utf8'), 'A 1\n');
  assert.equal((await createScriptStorage({ userData: f.userData })).getRoot(), f.original);
});
test('a missing configured drive is reported instead of silently creating a default library', async t => {
  const f = await fixture(t), plan = await f.storage.prepare(f.target);
  await f.storage.migrate(plan.token);
  await fs.rename(f.target, path.join(f.directory, 'unavailable'));
  await assert.rejects(createScriptStorage({ userData: f.userData }), /脚本目录无法访问/);
});
