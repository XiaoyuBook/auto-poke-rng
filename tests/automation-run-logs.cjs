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

test('export flushes full diagnostic history across all rounds even after the UI is cleared', async t => {
  const f = fixture(t); f.store.beginRun('exported', 'frlg');
  for (const round of [0, 1, 2]) {
    f.store.history('exported', 'frlg_round', [{ number: round, data: {} }]);
    f.store.log(`第 ${round} 轮摘要`, 'ECS', 'info', { runId: 'exported', round });
    f.store.diagnostic('exported', { event: 'script.diagnostic', round, raw: `完整 OCR ${round}` });
  }
  f.store.clearLogs();
  const destination = path.join(f.directory, 'export.jsonl');
  assert.equal(await f.store.runLogs.exportTo('exported', destination), destination);
  const rows = fs.readFileSync(destination, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.filter(row => row.raw).map(row => row.raw), ['完整 OCR 0', '完整 OCR 1', '完整 OCR 2']);
  assert.equal(rows.filter(row => row.message).length, 3);
  assert.deepEqual(rows, f.read(f.files()[0]));
  assert.deepEqual(f.store.logs, []);
});

test('an active export is bounded before subsequent writes and a finished export includes its final boundary', async t => {
  const f = fixture(t); f.store.beginRun('active-export', 'frlg');
  f.store.diagnostic('active-export', { event: 'before', raw: '原文'.repeat(100000) });
  const destination = path.join(f.directory, 'snapshot.jsonl');
  const exporting = f.store.runLogs.exportTo('active-export', destination);
  f.store.diagnostic('active-export', { event: 'after' });
  f.store.finishRun('active-export', 'completed', 'done');
  await exporting;
  const rows = fs.readFileSync(destination, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(row => row.event), ['run.started', 'before']);
  await f.store.runLogs.exportTo('active-export', destination);
  assert.equal(JSON.parse(fs.readFileSync(destination, 'utf8').trim().split('\n').at(-1)).event, 'run.finished');
});

test('export rejects missing, expired, invalid and archive destinations without changing saved data', async t => {
  const f = fixture(t); f.store.beginRun('one', 'frlg'); f.store.finishRun('one', 'completed', 'done');
  const destination = path.join(f.directory, 'copy.jsonl'), source = f.store.runLogs.resolve('one');
  const before = fs.readFileSync(source, 'utf8');
  for (const runId of ['../one', 'one/../../secret', '', null, 42]) {
    await assert.rejects(f.store.runLogs.exportTo(runId, destination), /标识无效/);
  }
  await assert.rejects(f.store.runLogs.exportTo('missing', destination), /没有已保存/);
  await assert.rejects(f.store.runLogs.exportTo('one', source), /归档目录之外/);
  await assert.rejects(f.store.runLogs.exportTo('one', path.join(f.store.runLogs.directory, 'copy.jsonl')), /归档目录之外/);
  assert.equal(fs.readFileSync(source, 'utf8'), before);
  for (let i = 0; i < 30; i++) { f.store.beginRun(`new-${i}`, 'frlg'); f.store.finishRun(`new-${i}`, 'completed', 'done'); }
  await assert.rejects(f.store.runLogs.exportTo('one', destination), /文件已过期/);
  assert.equal(fs.existsSync(destination), false);
});

test('export cannot overwrite the archive through a hard link outside its directory', async t => {
  const f = fixture(t); f.store.beginRun('linked', 'frlg'); f.store.finishRun('linked', 'completed', 'done');
  const source = f.store.runLogs.resolve('linked'), destination = path.join(f.directory, 'alias.jsonl');
  const before = fs.readFileSync(source, 'utf8');
  fs.linkSync(source, destination);
  await assert.rejects(f.store.runLogs.exportTo('linked', destination), /链接/);
  assert.equal(fs.readFileSync(source, 'utf8'), before);
});

test('an empty damaged archive closes its descriptor and leaves the destination untouched', async t => {
  const f = fixture(t); f.store.beginRun('empty', 'frlg');
  fs.truncateSync(f.store.runLogs.resolve('empty'));
  const destination = path.join(f.directory, 'existing.jsonl'); fs.writeFileSync(destination, 'keep');
  const close = t.mock.method(fs, 'closeSync');
  await assert.rejects(f.store.runLogs.exportTo('empty', destination), /为空/);
  assert.equal(close.mock.callCount(), 1);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'keep');
});

test('logging gaps are marked in both the run and exported file without inventing missing diagnostics', async t => {
  const f = fixture(t); f.store.beginRun('gaps', 'frlg');
  assert.equal(f.store.runs[0].diagnosticsIncomplete, false);
  f.store.setLogging(false);
  f.store.diagnostic('gaps', { event: 'missing' });
  f.store.setLogging(true);
  f.store.diagnostic('gaps', { event: 'resumed' });
  f.store.finishRun('gaps', 'completed', 'done');
  assert.equal(f.store.runs[0].diagnosticsIncomplete, true);
  const destination = path.join(f.directory, 'gaps.jsonl'); await f.store.runLogs.exportTo('gaps', destination);
  const rows = fs.readFileSync(destination, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.filter(row => row.event === 'logging.changed').map(row => row.enabled), [false, true]);
  assert.ok(rows.some(row => row.event === 'resumed'));
  assert.ok(!rows.some(row => row.event === 'missing'));
  f.store.setLogging(false); f.store.beginRun('disabled', 'frlg');
  assert.equal(f.store.runs[0].diagnosticsIncomplete, true);
  await assert.rejects(f.store.runLogs.exportTo('disabled', path.join(f.directory, 'disabled.jsonl')), /没有已保存/);
});

test('logging can still be disabled when its diagnostic boundary fails to write', t => {
  const f = fixture(t); f.store.beginRun('write-failed', 'frlg');
  t.mock.method(f.store.runLogs, 'append', () => { throw Error('disk failure'); });
  assert.doesNotThrow(() => f.store.setLogging(false));
  assert.equal(f.store.data.logging, false);
  assert.match(f.store.error, /disk failure/);
  assert.equal(f.store.runs[0].diagnosticsIncomplete, true);
});

test('real Python host sends full hidden OCR and controller timing to the run file', async t => {
  const f = fixture(t), controller = new EventEmitter();
  controller.child = { killed: false };
  controller.call = async method => method === 'controller.status' ? { status: 'connected' }
    : method === 'controller.acquire' ? { owner: 'test' } : {};
  controller.sequence = async () => ({});
  const audioReport = '【音频判闪·实验】窗口=5；无法判定；threshold=0.85；start_qpc_ns=1234；score=0.6338；enhanced_score=0.1108；reason=提前截止，未覆盖计划音频窗口';
  const text = ['# GUI_ECS_LOG_POLICY_V1 mode=compact', 'PRINT "OCR原文:HAGNEHITE"',
    'PRINT "后处理:MAGNEMITE"', `PRINT "${audioReport}"`, 'A', 'WAIT 1', 'PRINT 已命中目标'].join('\n');
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
    assert.ok(rows.some(x => x.kind === 'ecs.output' && x.message.trim() === audioReport));
    assert.ok(f.store.logs.some(x => x.message === '【音频判闪·实验】无法判定；分数 0.6338 / 阈值 0.85；采样提前结束'));
    assert.equal(f.store.logs.some(x => /start_qpc_ns|enhanced_score/.test(x.message)), false);
    assert.ok(rows.some(x => x.kind === 'controller.request' && x.params?.actions?.[0]?.key === 'A'));
    assert.ok(rows.some(x => x.kind === 'controller.reply' && x.elapsedMs >= 0));
    assert.equal(f.store.logs.some(x => x.message.includes('OCR原文')), false);
  } finally { clearTimeout(timeout); }
});
