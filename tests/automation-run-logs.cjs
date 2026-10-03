const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { AutomationStore } = require('../electron/automation-store.cjs');
const { ScriptRunner } = require('../electron/script-runner.cjs');
const { EventEmitter } = require('node:events');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'poke-run-logs-'));
  const store = new AutomationStore(directory, { now: () => new Date('2026-10-03T15:00:00Z') });
  t.after(() => { store.runLogs.flush(); fs.rmSync(directory, { recursive: true, force: true }); });
  const files = () => fs.readdirSync(path.join(directory, 'logs/runs')).filter(name => name.endsWith('.jsonl')).sort();
  const read = name => fs.readFileSync(path.join(directory, 'logs/runs', name), 'utf8').trim().split('\n').map(JSON.parse);
  return { directory, store, files, read };
}

test('disk archive retains thirty runs, not thirty rounds, across app restart', t => {
  const f = fixture(t);
  for (let i = 0; i < 31; i++) {
    f.store.beginRun(`flow-${i}`, 'frlg', { request: { seed: i } });
    for (let round = 0; round < (i === 30 ? 100 : 2); round++) {
      f.store.history(`flow-${i}`, 'frlg_round', [{ number: round, data: { frameError: round - 1 } }]);
      f.store.diagnostic(`flow-${i}`, { event: 'script.diagnostic', kind: 'ecs.output', round, message: `OCR原文:HAGNEHITE ${round}` });
    }
    f.store.finishRun(`flow-${i}`, 'stopped', 'done');
  }
  assert.equal(f.files().length, 30);
  assert.ok(!f.files().some(name => name.endsWith('_flow-0.jsonl')));
  const latest = f.read(f.files().at(-1));
  assert.equal(latest.filter(row => row.kind === 'ecs.output').length, 100);
  assert.equal(latest[0].event, 'run.started');
  assert.equal(latest.at(-1).event, 'run.finished');
  const restored = new AutomationStore(f.directory);
  restored.beginRun('next', 'frlg'); restored.finishRun('next', 'completed', 'ok');
  assert.equal(f.files().length, 30);
  assert.ok(!f.files().some(name => name.endsWith('_flow-1.jsonl')));
});

test('hidden diagnostics persist without changing UI logs or being cleared with them', t => {
  const f = fixture(t);
  f.store.beginRun('one', 'frlg');
  f.store.log('反查完成', 'ECS', 'info', { runId: 'one', round: 1 });
  f.store.diagnostic('one', { event: 'script.diagnostic', kind: 'ocr.inference.end', raw: 'HAGNEHITE', confidence: .96 });
  assert.deepEqual(f.store.logs.map(x => x.message), ['反查完成']);
  f.store.clearLogs(); f.store.finishRun('one', 'completed', 'ok');
  const rows = f.read(f.files()[0]);
  assert.ok(rows.some(row => row.raw === 'HAGNEHITE'));
  assert.ok(rows.some(row => row.message === '反查完成'));
  assert.equal(f.store.logs.length, 0);
});

test('retention does not delete unrelated files or interrupt an active run', t => {
  const f = fixture(t); f.store.beginRun('active', 'frlg');
  fs.writeFileSync(path.join(f.directory, 'logs/runs/notes.jsonl'), 'keep');
  for (let i = 0; i < 31; i++) { f.store.beginRun(`r${i}`, 'frlg'); f.store.finishRun(`r${i}`, 'failed', 'test'); }
  assert.ok(f.files().some(name => name.endsWith('_active.jsonl')));
  f.store.diagnostic('active', { event: 'late', value: 1 });
  f.store.finishRun('active', 'stopped', 'done');
  assert.equal(f.files().filter(name => name.startsWith('run_')).length, 30);
  assert.equal(fs.readFileSync(path.join(f.directory, 'logs/runs/notes.jsonl'), 'utf8'), 'keep');
});

test('real Python host sends full hidden OCR and controller timing to the run file', async t => {
  const f = fixture(t), controller = new EventEmitter();
  controller.child = { killed: false };
  controller.call = async method => method === 'controller.status' ? { status: 'connected' }
    : method === 'controller.acquire' ? { owner: 'test' } : {};
  controller.sequence = async () => ({});
  const text = '# GUI_ECS_LOG_POLICY_V1 mode=compact\nPRINT "OCR原文:HAGNEHITE"\nPRINT "后处理:MAGNEMITE"\nA\nWAIT 1\nPRINT 已命中目标';
  fs.writeFileSync(path.join(f.directory, 'test.ecs'), text);
  f.store.beginRun('real', 'frlg');
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const runner = new ScriptRunner({ controller, rootDirectory: f.directory, emit: event => {
    if (event.event === 'script.diagnostic') f.store.diagnostic('real', event);
    if (event.event === 'script.log') f.store.log(event.message, 'ECS', 'info', { runId: 'real' });
    if (event.event === 'script.done') resolveDone(event);
  } });
  t.after(() => runner.stop());
  await runner.start({ text, path: 'test.ecs', diagnostics: true });
  const timeout = setTimeout(() => void runner.stop('test timeout'), 10000);
  try {
    assert.equal((await done).status, 'completed');
    f.store.finishRun('real', 'completed', 'ok');
    const rows = f.read(f.files()[0]);
    assert.ok(rows.some(x => x.kind === 'ecs.output' && x.message.includes('OCR原文:HAGNEHITE')));
    assert.ok(rows.some(x => x.kind === 'ecs.output' && x.message.includes('后处理:MAGNEMITE')));
    assert.ok(rows.some(x => x.kind === 'controller.request' && x.params?.actions?.[0]?.key === 'A'));
    assert.ok(rows.some(x => x.kind === 'controller.reply' && x.elapsedMs >= 0));
    assert.equal(f.store.logs.some(x => x.message.includes('OCR原文')), false);
  } finally { clearTimeout(timeout); }
});
