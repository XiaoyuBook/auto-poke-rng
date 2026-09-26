const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AutomationStore } = require('../electron/automation-store.cjs');

function fixture(t, now = () => new Date(2026, 8, 25, 10)) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'poke-automation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, store: new AutomationStore(directory, { now }) };
}
test('C01: parameter save preserves scripts, including deliberately empty choices', t => {
  const { directory, store } = fixture(t);
  store.save('static', 'scripts', { seed: 'BDSP/测种.rng', hit: '' });
  store.save('static', 'parameters', { fixed_delay: 1234 });
  const restored = new AutomationStore(directory).snapshot();
  assert.equal(restored.config.static.scripts.seed, 'BDSP/测种.rng');
  assert.equal(restored.config.static.scripts.hit, '');
  assert.equal(restored.config.static.parameters.fixed_delay, 1234);
});
test('C01: a failed persistence write must not replace accepted settings', t => {
  const { store } = fixture(t);
  store.save('tid', 'parameters', { delay: 12 });
  store.persist = () => { throw Error('disk full'); };
  assert.throws(() => store.save('tid', 'parameters', { delay: 99 }), /disk full/);
  assert.equal(store.snapshot().config.tid.parameters.delay, 12);
});

test('split package paths migrate only configured matches and persist atomically', t => {
  const { directory, store } = fixture(t);
  store.save('static', 'scripts', { seed: 'BDSP/测种.rng', hit: 'personal/custom.txt', exit: '' });
  store.save('tid', 'scripts', { seed: 'BDSP/测种.txt' });
  const target = '珍钻复刻/测种/测种.txt', aliases = { 'BDSP/测种.rng': target, 'BDSP/测种.txt': target };
  const persist = store.persist.bind(store);
  store.persist = () => { throw Error('disk full'); };
  assert.throws(() => store.migrateScriptPaths(aliases), /disk full/);
  assert.equal(store.snapshot().config.static.scripts.seed, 'BDSP/测种.rng');
  store.persist = persist; store.migrateScriptPaths(aliases);
  const config = new AutomationStore(directory).snapshot().config;
  assert.equal(config.static.scripts.seed, target); assert.equal(config.tid.scripts.seed, target);
  assert.equal(config.static.scripts.hit, 'personal/custom.txt'); assert.equal(config.static.scripts.exit, '');
});
test('D03: delay samples stay scoped to species and excluded samples can be restored', t => {
  const { directory, store } = fixture(t);
  store.recordDelay(492, [101, 100, 101, -1]);
  store.recordDelay(487, [200]);
  store.excludeDelay(492, 1, true);
  const restored = new AutomationStore(directory);
  assert.deepEqual(restored.snapshot().profiles['492'].samples[0].candidates, [100, 101]);
  assert.equal(restored.snapshot().profiles['492'].samples[0].excluded, true);
  restored.excludeDelay(492, 1, false);
  restored.clearDelay(492);
  assert.equal(restored.snapshot().profiles['487'].samples.length, 1);
});
test('L05/L06: clear display and disable logging never delete existing disk logs', t => {
  const { directory, store } = fixture(t);
  store.log('first', '自动定点', 'info', { runId: 'r1', round: 1 });
  const file = path.join(directory, 'logs', 'run_2026-09-25.log');
  const saved = fs.readFileSync(file, 'utf8');
  store.clearLogs(); store.setLogging(false); store.log('second');
  assert.equal(fs.readFileSync(file, 'utf8'), saved);
  assert.deepEqual(store.snapshot().logs.map(row => row.message), ['second']);
});
test('L05: keep seven local calendar days, never remove unrelated files', t => {
  const { directory, store } = fixture(t);
  fs.mkdirSync(path.join(directory, 'logs'), { recursive: true });
  for (const day of ['17', '18', '19', '25']) fs.writeFileSync(path.join(directory, 'logs', `run_2026-09-${day}.log`), 'old');
  fs.writeFileSync(path.join(directory, 'logs', 'notes.log'), 'keep');
  store.log('new');
  assert.equal(fs.existsSync(path.join(directory, 'logs', 'run_2026-09-18.log')), false);
  assert.equal(fs.existsSync(path.join(directory, 'logs', 'run_2026-09-19.log')), true);
  assert.equal(fs.readFileSync(path.join(directory, 'logs', 'notes.log'), 'utf8'), 'keep');
});
test('L01/L02: rounds retain different outcomes and immutable candidate snapshots', t => {
  const { store } = fixture(t);
  store.beginRun('r1', 'static'); store.history('r1', 'cycle_start', [1]);
  const candidates = [{ advances: 1800, pid: 11, ec: 22, ivs: [31, 0, 31, 31, 31, 31] }];
  store.history('r1', 'candidates_found', [candidates, 0, ['sync']]);
  candidates[0].advances = 1;
  store.history('r1', 'cycle_result', [false, 3.1, 340, 1400]);
  store.history('r1', 'cycle_start', [2]); store.history('r1', 'cycle_no_candidate', []);
  const rounds = store.snapshot().runs[0].rounds;
  assert.equal(rounds[0].candidates[0].advances, 1800);
  assert.equal(rounds[0].outcome, '未出闪'); assert.equal(rounds[1].outcome, '无候选');
  assert.equal(rounds[0].usedDelay, 1400);
});

test('L01: unknown OCR and restarted rounds are not labelled definite misses or running forever', t => {
  const {store}=fixture(t);store.beginRun('r','static');store.history('r','cycle_start',[1]);
  store.history('r','cycle_result',[false,null,1,100]);
  store.history('r','cycle_start',[2]);store.history('r','cycle_restart',['校正失败']);
  assert.equal(store.runs[0].rounds[0].outcome,'判闪未知');
  assert.equal(store.runs[0].rounds[1].outcome,'继续重试');
});
