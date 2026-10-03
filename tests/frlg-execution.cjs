const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerFrlgAutomation } = require('../electron/frlg-automation.cjs');
const plan = require('./fixtures/frlg-golbat-plan.json');

function harness({ beforePrepare, outcome = 'completed', immediateDone = false, connected = true, store } = {}) {
  const handlers = new Map(), events = new EventEmitter(), sent = [], logs = [], logRows = [], calls = [];
  const sender = { mainFrame: {}, send: (channel, state) => sent.push([channel, state]) };
  const event = { sender, senderFrame: sender.mainFrame };
  let locked = false, running = false;
  const devices = {
    events, getState: () => ({ controller: { status: connected ? 'connected' : 'disconnected' }, video: { status: 'connected' } }),
    claimAutomation: async () => { if (locked) throw Error('busy'); locked = true; },
    releaseAutomation: () => { locked = false; },
    runner: {
      rootDirectory: 'D:/test-library',
      validate: async () => ({ valid: true }),
      start: async args => { calls.push({ scriptStart: args }); running = true; if (immediateDone) events.emit('script', { event: 'script.done', runId: 'script1', status: outcome }); return { runId: 'script1' }; },
      stop: async () => { if (running) { running = false; events.emit('script', { event: 'script.done', runId: 'script1', status: 'cancelled' }); } },
    },
  };
  const service = registerFrlgAutomation({
    ipcMain: { handle: (name, action) => handlers.set(name, action) }, getMainWindow: () => ({ webContents: sender }),
    devices, client: { call: async (method) => { calls.push(method); if (method === 'prepare') { await beforePrepare?.(); return { main: 'D:/test-library/generated/main.ecs', manifest: 'manifest.json' }; } return { calibrationUpdated: true }; }, close: () => {} },
    userData: 'D:/test-data', store, log: (...args) => { logs.push(args[0]); logRows.push(args); }, notifications: { notifyTask: async (...args) => calls.push(args) },
    readFile: async file => file === 'manifest.json' ? JSON.stringify({ plan }) : 'PRINT test', makeDirectory: async () => {},
  });
  const invoke = (name, args) => handlers.get('frlg-automation:' + name)(event, args);
  const done = () => events.emit('script', { event: 'script.done', runId: 'script1', status: outcome });
  return { service, invoke, done, events, calls, logs, logRows, handlers, locked: () => locked };
}

test('rejects duplicate starts and foreign IPC senders', async () => {
  const h = harness();
  await h.invoke('start', { request: plan.request, profileId: 'save-a' });
  assert.throws(() => h.invoke('start', { request: plan.request, profileId: 'save-b' }), /正在运行/);
  assert.throws(() => h.handlers.get('frlg-automation:stop')({ sender: {}, senderFrame: {} }), /sender/);
  await h.invoke('stop');
  assert.equal(h.locked(), false);
});

test('FRLG structured records retain independent rounds and round-scoped logs', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { AutomationStore } = require('../electron/automation-store.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'frlg-rounds-'));
  try {
    const store = new AutomationStore(directory);
    const h = harness({ store });
    await h.invoke('start', { request: plan.request, profileId: 'save-a' });
    h.events.emit('script', { event: 'script.started', runId: 'script1' });
    h.events.emit('script', { event: 'script.round', runId: 'other-script', number: 99 });
    h.events.emit('script', { event: 'script.round', runId: 'script1', number: 1, start: true });
    h.events.emit('script', { event: 'script.round', runId: 'script1', number: 1, data: { request: { seedMs: 1200, f1: 5 }, hitSeed: 'ABCD', frameError: -2, result: '已反查' } });
    h.events.emit('script', { event: 'script.log', runId: 'script1', message: '反查完成' });
    h.events.emit('script', { event: 'script.round', runId: 'script1', number: 2, start: true });
    h.events.emit('script', { event: 'script.round', runId: 'script1', number: 2, data: { request: { seedMs: 1210 } } });
    h.events.emit('script', { event: 'script.round', runId: 'script1', number: 2,
      data: { result: '校准跳过', note: '本轮结果波动较大，参数保持不变' } });
    h.done(); await h.service.settled();
    const rounds = store.snapshot().runs[0].rounds;
    assert.deepEqual(rounds.map(round => round.number), [0, 1, 2]);
    assert.equal(rounds[1].frlg.hitSeed, 'ABCD');
    assert.equal(rounds[1].frlg.frameError, -2);
    assert.equal(rounds[2].frlg.hitSeed, undefined);
    assert.equal(rounds[2].outcome, '校准跳过');
    assert.deepEqual(rounds[2].frlg.notes, ['本轮结果波动较大，参数保持不变']);
    assert.ok(rounds.every(round => round.startedAt && round.endedAt));
    assert.equal(h.logRows.find(row => row[0] === '反查完成')[3].round, 1);
    assert.ok(h.logRows.some(row => row[3]?.event === 'frlg.round' && row[3].detailOnly === true && row[3].data?.frameError === -2));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('FRLG archives full diagnostics, generated plan and BINGO without UI noise', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { AutomationStore } = require('../electron/automation-store.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'frlg-diagnostic-routing-'));
  const store = new AutomationStore(directory), h = harness({ store });
  try {
    await h.invoke('start', { request: plan.request, profileId: 'save-a' });
    h.events.emit('script', { event: 'script.round', runId: 'script1', number: 7 });
    h.events.emit('script', { event: 'script.diagnostic', runId: 'script1', kind: 'ecs.output', message: 'OCR原文:HAGNEHITE' });
    h.events.emit('script', { event: 'script.bingo', runId: 'script1', state: { observed: true, current: { seed: 1, frame: -1 } } });
    h.events.emit('script', { event: 'script.image-result', runId: 'script1', labelName: 'normal', scriptValue: 95, score: .95 });
    h.done(); await h.service.settled();
    const file = fs.readdirSync(path.join(directory, 'logs/runs')).find(name => name.endsWith('.jsonl'));
    const rows = fs.readFileSync(path.join(directory, 'logs/runs', file), 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(rows.some(x => x.event === 'frlg.plan' && x.manifest.plan));
    assert.ok(rows.some(x => x.kind === 'ecs.output' && x.round === 7 && x.message === 'OCR原文:HAGNEHITE'));
    assert.ok(rows.some(x => x.event === 'script.bingo' && x.state.current.frame === -1));
    assert.ok(rows.some(x => x.event === 'script.image-result' && x.scriptValue === 95));
    assert.equal(h.logs.includes('OCR原文:HAGNEHITE'), false);
  } finally { store.flushDiagnostics(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('done before start response still settles and releases device ownership', async () => {
  const h = harness({ immediateDone: true });
  await h.invoke('start', { request: plan.request, profileId: 'save-a' });
  await h.service.settled();
  assert.equal((await h.invoke('state')).status, 'completed');
  assert.equal(h.locked(), false);
});

test('disconnected device fails preflight without running or saving calibration', async () => {
  const h = harness({ connected: false });
  await assert.rejects(h.invoke('start', { request: plan.request, profileId: 'save-a' }), /连接伊机控/);
  await h.service.settled();
  assert.equal(h.locked(), false);
  assert.equal((await h.invoke('state')).status, 'failed');
  assert.deepEqual(h.calls.filter(call => typeof call === 'string'), ['prepare']);
});

test('FRLG runs through shared runner, logs, calibration, notification and releases ownership', async () => {
  const h = harness();
  await h.invoke('start', { request: plan.request, profileId: 'save-a', options: { update_precalibration: true } });
  assert.equal(h.calls.find(call => call?.scriptStart)?.scriptStart.audioDiagnostic, true);
  assert.equal(h.calls.find(call => call?.scriptStart)?.scriptStart.diagnostics, true);
  assert.equal(h.locked(), true);
  h.events.emit('script', { event: 'script.log', runId: 'script1', message: '阶段开始：wild.data.candidate_range' });
  h.events.emit('script', { event: 'script.log', runId: 'script1', message: '反查完成' });
  h.events.emit('script', { event: 'script.bingo', runId: 'script1', state: { version: 1, grid: [] } });
  h.done();
  await h.service.settled();
  assert.equal(h.locked(), false);
  assert.ok(h.logs.includes('反查完成'));
  assert.ok(h.logRows.some(row => row[0] === '反查完成' && row[1] === 'ECS' && row[3].runId));
  assert.ok(h.logRows.some(row => row[0] === '阶段开始：wild.data.candidate_range' && row[3].detailOnly === true));
  assert.ok((await h.invoke('state')).logEntries.some(row => row.message === '阶段开始：wild.data.candidate_range' && row.detailOnly === true));
  assert.ok((await h.invoke('state')).logEntries.some(row => row.message === '反查完成' && row.source === 'ECS'));
  assert.deepEqual((await h.invoke('state')).bingo, { version: 1, grid: [] });
  assert.ok(h.calls.includes('finalize'));
  assert.equal((await h.invoke('state')).status, 'completed');
});

test('stop during generation never starts a controller script or saves calibration', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const h = harness({ beforePrepare: () => wait });
  const start = h.invoke('start', { request: plan.request, profileId: 'save-a', options: {} });
  await new Promise(resolve => setImmediate(resolve));
  const stop = h.invoke('stop');
  release();
  await Promise.allSettled([start, stop]);
  assert.equal(h.locked(), false);
  assert.equal((await h.invoke('state')).status, 'stopped');
  assert.ok(!h.calls.includes('finalize'));
});

test('failed capture/reverse run cannot be reported or persisted as successful', async () => {
  const h = harness({ outcome: 'failed' });
  await h.invoke('start', { request: plan.request, profileId: 'save-b', options: { update_precalibration: true } });
  h.done();
  await h.service.settled();
  assert.equal((await h.invoke('state')).status, 'failed');
  assert.ok(!h.calls.includes('finalize'));
});

test('FRLG run is available in the shared run history with its own source labels', async () => {
  const stored = { runs: [], beginRun(id, kind, context) { this.runs.push({ id, kind, context }); }, finishRun(id, status, message) { Object.assign(this.runs.find(run => run.id === id), { status, message }); } };
  const h = harness({ store: stored });
  await h.invoke('start', { request: plan.request, profileId: 'save-c', options: {} });
  h.events.emit('script', { event: 'script.log', runId: 'script1', message: 'ECS 反查诊断' });
  h.done();
  await h.service.settled();
  assert.equal(stored.runs.length, 1);
  assert.equal(stored.runs[0].kind, 'frlg');
  assert.equal(stored.runs[0].context.profileId, 'save-c');
  assert.equal(stored.runs[0].status, 'completed');
  assert.ok(h.logRows.some(row => row[0] === 'ECS 反查诊断' && row[1] === 'ECS'));
});
