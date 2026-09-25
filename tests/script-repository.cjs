const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { zipSync } = require('fflate');
const { createScriptRepository, registerScriptRepository, unpackArchive } = require('../electron/script-repository.cjs');
const { createScriptGate, initializeUserScripts } = require('../electron/script-storage.cjs');
const { createScriptStore } = require('../electron/script-files.cjs');
const { ScriptRunner } = require('../electron/script-runner.cjs');
const { EventEmitter } = require('node:events');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function pack(version = '1.0.0', contents = { '测试.txt': 'A 1\n', 'ImgLabel/宝可表.IL': '{"ImgBase64":"ABC","searchMethod":5}' }, extra = {}) {
  const files = Object.fromEntries(Object.entries(contents).map(([name,body]) => [name, Buffer.from(body)]));
  const manifest = { schemaVersion: 1, id: 'demo', installFolder: 'BDSP', name: '测试脚本包', authors: ['author'], description: '测试包', game: 'BDSP', version, minimumAppVersion: '0.1.0',
    files: Object.entries(files).map(([name,bytes]) => ({ path: name, sha256: hash(bytes), bytes: bytes.length })), ...extra };
  const bytes = Buffer.from(zipSync({ 'manifest.json': Buffer.from(JSON.stringify(manifest)), ...Object.fromEntries(Object.entries(files).map(([name,bytes]) => ['files/' + name, bytes])) }));
  return { manifest, bytes, catalog: { schemaVersion: 1, packages: [{ ...manifest, archive: `packages/demo/${version}.zip`, sha256: hash(bytes), bytes: bytes.length }] } };
}
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poke-repository-'));
  const rootDirectory = path.join(directory, 'scripts'), logs = [], requests = [], gate = createScriptGate();
  let remote = pack(), offline = false, busy = false;
  const serviceOptions = { rootDirectory, userData: directory, appVersion: '0.1.0', gate, log: message => logs.push(message), isBusy: () => busy,
    fetch: async url => { requests.push(url); if (offline) throw Error('offline'); return new Response(url.endsWith('catalog.json') ? JSON.stringify(remote.catalog) : remote.bytes); }, ...options };
  const service = createScriptRepository(serviceOptions);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const install = async bytes => service.apply({ token: (await service.planArchive(bytes)).token, policy: 'keep' });
  return { directory, rootDirectory, service, serviceOptions, gate, logs, requests, install, setRemote: value => { remote = value; }, offline: () => { offline = true; }, busy: value => { busy = value; },
    read: name => fs.readFile(path.join(rootDirectory, 'BDSP', name), 'utf8'), write: async (name,body) => { const file = path.join(rootDirectory, 'BDSP', name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, body); } };
}
test('official catalog downloads a verified complete txt package and execution accepts it', async t => {
  const f = await fixture(t);
  assert.equal((await f.service.state()).cached, false);
  await f.service.refresh();
  const plan = await f.service.prepare('demo');
  assert.equal(plan.changes.length, 2); assert.deepEqual(plan.conflicts, []);
  const result = await f.service.apply({ token: plan.token, policy: 'keep' });
  assert.equal(result.state.installed[0].version, '1.0.0');
  assert.equal(result.backupPath, null);
  const listing = await createScriptStore(f.rootDirectory).list();
  assert.equal(listing.files[0].path, 'BDSP/测试.txt');
  const runner = new ScriptRunner({ controller: new EventEmitter(), rootDirectory: f.rootDirectory, emit: () => {} });
  assert.equal((await runner.validate({ path: listing.files[0].path, text: listing.files[0].body })).valid, true);
  assert.equal((await runner.resolveScript('BDSP/测试.rng')).absolute, path.join(f.rootDirectory, 'BDSP/测试.txt'));
  assert.ok(f.requests.every(url => url.startsWith('https://raw.githubusercontent.com/XiaoyuBook/auto-poke-rng-scripts/main/')));
  assert.ok(f.logs.some(message => message.includes('已安装')));
});
test('offline startup retains the cached catalog and existing scripts', async t => {
  const f = await fixture(t); await f.service.refresh(); await f.install(pack().bytes); f.offline();
  const restarted = createScriptRepository(f.serviceOptions);
  assert.equal((await restarted.state()).packages.length, 1);
  await assert.rejects(restarted.refresh(), /offline/);
  assert.equal((await restarted.state()).installed.length, 1);
  assert.equal(await f.read('测试.txt'), 'A 1\n');
});
test('local script and label edits are preserved while unmodified files update', async t => {
  const f = await fixture(t); await f.install(pack().bytes);
  await f.write('测试.txt', 'B 2\n'); await f.write('ImgLabel/宝可表.IL', 'my-label'); await f.write('用户文件.txt', 'user');
  const next = pack('1.1.0', { '测试.txt': 'X 1\n', 'ImgLabel/宝可表.IL': '{"ImgBase64":"NEW","searchMethod":5}', '新增.txt': 'Y 1\n' });
  const plan = await f.service.planArchive(next.bytes);
  assert.deepEqual(plan.conflicts.sort(), ['ImgLabel/宝可表.IL', '测试.txt'].sort());
  const result = await f.service.apply({ token: plan.token, policy: 'keep' });
  assert.equal(result.kept, 2); assert.equal(result.state.installed[0].modified, true);
  assert.equal(await f.read('测试.txt'), 'B 2\n'); assert.equal(await f.read('ImgLabel/宝可表.IL'), 'my-label');
  assert.equal(await f.read('新增.txt'), 'Y 1\n'); assert.equal(await f.read('用户文件.txt'), 'user');
  assert.equal(await fs.readFile(path.join(result.backupPath, '测试.txt'), 'utf8'), 'B 2\n');
});
test('explicit replacement backs up edits; removed upstream files do not erase unrelated files', async t => {
  const f = await fixture(t); await f.install(pack().bytes); await f.write('测试.txt', 'local'); await f.write('custom.txt', 'custom');
  const plan = await f.service.planArchive(pack('1.1.0', { '测试.txt': 'B 1\n' }).bytes);
  assert.ok(plan.changes.some(change => change.path.endsWith('.IL') && change.action === 'remove'));
  const result = await f.service.apply({ token: plan.token, policy: 'replace' });
  assert.equal(await f.read('测试.txt'), 'B 1\n'); assert.equal(await f.read('custom.txt'), 'custom');
  await assert.rejects(f.read('ImgLabel/宝可表.IL'), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(result.backupPath, '测试.txt'), 'utf8'), 'local');
});
test('locally deleted files are not resurrected under keep policy', async t => {
  const f = await fixture(t); await f.install(pack().bytes);
  await fs.unlink(path.join(f.rootDirectory, 'BDSP/测试.txt'));
  const plan = await f.service.planArchive(pack('1.1.0').bytes);
  assert.ok(plan.conflicts.includes('测试.txt'));
  await f.service.apply({ token: plan.token, policy: 'keep' });
  await assert.rejects(f.read('测试.txt'), { code: 'ENOENT' });
});
test('unmanaged existing files require a conflict choice and survive default installation', async t => {
  const f = await fixture(t); await f.write('测试.txt', 'personal');
  const plan = await f.service.planArchive(pack().bytes);
  assert.deepEqual(plan.conflicts, ['测试.txt']);
  await f.service.apply({ token: plan.token, policy: 'keep' });
  assert.equal(await f.read('测试.txt'), 'personal');
});
test('changed files, active execution, and invalidated previews cannot be applied', async t => {
  const f = await fixture(t); const initial = await f.service.planArchive(pack().bytes);
  f.busy(true); await assert.rejects(f.service.apply({ token: initial.token, policy: 'keep' }), /停止脚本/); f.busy(false);
  await f.write('new.txt', 'new');
  await assert.rejects(f.service.apply({ token: initial.token, policy: 'replace' }), /本地文件已变化/);
  const newer = await f.service.planArchive(pack().bytes);
  await assert.rejects(f.service.apply({ token: initial.token, policy: 'keep' }), /过期/);
  await f.service.apply({ token: newer.token, policy: 'keep' });
  await assert.rejects(f.service.planArchive(pack('0.9.0').bytes), /降级/);
});
test('failed final rename restores original scripts and releases the write gate', async t => {
  let fail = false;
  const f = await fixture(t, { rename: async (from,to) => { if (fail && from.includes(path.sep + 'staging' + path.sep)) throw Error('disk failure'); await fs.rename(from,to); } });
  await f.install(pack().bytes); fail = true;
  const plan = await f.service.planArchive(pack('1.1.0', { '测试.txt': 'B 1\n' }).bytes);
  await assert.rejects(f.service.apply({ token: plan.token, policy: 'replace' }), /disk failure/);
  assert.equal(await f.read('测试.txt'), 'A 1\n'); assert.equal(f.gate.busy, false);
  assert.equal((await f.service.state()).installed[0].version, '1.0.0');
});
test('archive and version validation fail before creating installed files', async t => {
  const f = await fixture(t), input = pack();
  await assert.rejects(f.service.planArchive(pack('1.0.0', undefined, { minimumAppVersion: '99.0.0' }).bytes), /需要/);
  assert.throws(() => unpackArchive(zipSync({ '../escape.txt': Buffer.from('bad') })), /路径/);
  assert.throws(() => unpackArchive(zipSync({ 'manifest.json': Buffer.from(JSON.stringify(input.manifest)), 'files/测试.txt': Buffer.from('wrong') })), /校验失败/);
  assert.throws(() => unpackArchive(pack('1.0.0', { 'script.exe': 'bad', '测试.txt': 'A 1' }).bytes), /资源路径/);
  const broken = pack(); broken.bytes[0] ^= 1; f.setRemote(broken);
  await f.service.refresh(); await assert.rejects(f.service.prepare('demo'), /下载校验失败/);
  assert.deepEqual((await f.service.state()).installed, []);
});
test('package directory symlinks are rejected without changing their target', async t => {
  const f = await fixture(t), outside = path.join(f.directory, 'outside');
  await fs.mkdir(outside); await fs.mkdir(f.rootDirectory); await fs.writeFile(path.join(outside, '测试.txt'), 'untouched');
  await fs.symlink(outside, path.join(f.rootDirectory, 'BDSP'), 'junction');
  await assert.rejects(f.service.planArchive(pack().bytes), /不允许链接/);
  assert.equal(await fs.readFile(path.join(outside, '测试.txt'), 'utf8'), 'untouched');
});
test('first-run migration copies local changes once and never rewrites the old library', async t => {
  const f = await fixture(t), legacy = path.join(f.directory, 'legacy');
  await fs.mkdir(path.join(legacy, 'BDSP'), { recursive: true }); await fs.writeFile(path.join(legacy, 'BDSP/local.txt'), 'personal');
  assert.equal(await initializeUserScripts(f.directory, legacy), f.rootDirectory);
  assert.equal(await f.read('local.txt'), 'personal');
  await fs.writeFile(path.join(legacy, 'BDSP/local.txt'), 'new distribution');
  await initializeUserScripts(f.directory, legacy);
  assert.equal(await f.read('local.txt'), 'personal');
  await f.write('local.txt', 'edited');
  assert.equal(await fs.readFile(path.join(legacy, 'BDSP/local.txt'), 'utf8'), 'new distribution');
});
test('shared write gate queues saves and remains locked until all writes finish', async () => {
  const gate = createScriptGate(), trace = []; let release;
  const first = gate.run(async () => { trace.push('start'); await new Promise(resolve => { release = resolve; }); trace.push('end'); });
  const second = gate.run(async () => trace.push('save'));
  await new Promise(setImmediate); assert.equal(gate.busy, true); assert.deepEqual(trace, ['start']);
  release(); await first; await second; assert.deepEqual(trace, ['start','end','save']); assert.equal(gate.busy, false);
});
test('restart restores a backup if interrupted between the two directory renames', async t => {
  const f = await fixture(t); await f.install(pack().bytes);
  const stateDirectory = path.join(f.directory, 'script-repository');
  const backup = path.join(stateDirectory, 'backups/interrupted-backup');
  const stage = path.join(stateDirectory, 'staging/interrupted-stage');
  await fs.mkdir(stage, { recursive: true }); await fs.writeFile(path.join(stage, '测试.txt'), 'partial');
  await fs.rename(path.join(f.rootDirectory, 'BDSP'), backup);
  await fs.writeFile(path.join(stateDirectory, 'install-pending.json'), JSON.stringify({ folder: 'BDSP', stage: 'interrupted-stage', backup: 'interrupted-backup', transaction: 'interrupted' }));
  const restarted = createScriptRepository(f.serviceOptions);
  assert.equal((await restarted.state()).installed[0].version, '1.0.0');
  assert.equal(await f.read('测试.txt'), 'A 1\n');
  await assert.rejects(fs.stat(stage), { code: 'ENOENT' });
});
test('migration failures leave no partially initialized user script library', async t => {
  const f = await fixture(t), legacy = path.join(f.directory, 'legacy'), outside = path.join(f.directory, 'outside');
  await fs.mkdir(legacy); await fs.mkdir(outside); await fs.writeFile(path.join(legacy, 'local.txt'), 'personal');
  await fs.symlink(outside, path.join(legacy, 'linked'), 'junction');
  await assert.rejects(initializeUserScripts(f.directory, legacy), /包含链接/);
  await assert.rejects(fs.stat(f.rootDirectory), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(legacy, 'local.txt'), 'utf8'), 'personal');
});
test('case-only filename collisions cannot silently overwrite local files on Windows', async t => {
  const f = await fixture(t); await f.write('TEST.txt', 'my script');
  await assert.rejects(f.service.planArchive(pack('1.0.0', { 'test.txt': 'upstream' }).bytes), /大小写冲突/);
  assert.equal(await f.read('TEST.txt'), 'my script');
});
test('repository IPC rejects other windows and subframes before downloads or dialogs', async t => {
  const f = await fixture(t), handlers = {}, sender = { mainFrame: {} }; let dialogs = 0;
  registerScriptRepository({ ...f.serviceOptions, ipcMain: { handle: (name,fn) => { handlers[name] = fn; } }, getMainWindow: () => ({ webContents: sender }), dialog: { showOpenDialog: async () => { dialogs++; return { canceled: true }; } } });
  for (const handler of Object.values(handlers)) {
    await assert.rejects(handler({ sender: {}, senderFrame: {} }), /Unknown/);
    await assert.rejects(handler({ sender, senderFrame: {} }), /Unknown/);
  }
  assert.deepEqual(f.requests, []); assert.equal(dialogs, 0);
  assert.equal(await handlers['script-repository:import']({ sender, senderFrame: sender.mainFrame }), null);
});

test('malformed package identifiers and imprecise versions are rejected', () => {
  for (const extra of [{ id: undefined }, { id: null }, { version: '9007199254740993.0.0' }]) {
    assert.throws(() => unpackArchive(pack('1.0.0', undefined, extra).bytes), /描述无效/);
  }
});

test('updates preserve personal files whose names shadow object properties', async t => {
  const f = await fixture(t); await f.write('__proto__', 'personal metadata');
  await f.install(pack().bytes);
  assert.equal(await f.read('__proto__'), 'personal metadata');
});

test('case aliases in ancestor directories are rejected before installation', async t => {
  assert.throws(() => unpackArchive(pack('1.0.0', { 'Foo/a.txt': 'A 1', 'foo/b.txt': 'B 1' }).bytes), /大小写/);
  const f = await fixture(t); await f.write('User/local.txt', 'personal');
  await assert.rejects(f.service.planArchive(pack('1.0.0', { 'user/new.txt': 'A 1' }).bytes), /大小写/);
  assert.equal(await f.read('User/local.txt'), 'personal');
});
