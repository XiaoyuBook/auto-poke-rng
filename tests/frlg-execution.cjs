const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerFrlgAutomation } = require('../electron/frlg-automation.cjs');
const plan = require('./fixtures/frlg-golbat-plan.json');
const notificationsOf = h => h.calls.filter(Array.isArray);
async function until(action) {
  for (let i = 0; i < 100; ++i) { if (action()) return; await new Promise(setImmediate); }
  assert.fail('notification did not settle');
}

function harness({ beforePrepare, outcome = 'completed', immediateDone = false, connected = true, store, calibrationResult = { calibrationUpdated: true },
  captureImage, encodeNotificationImage, wantsTaskImage = () => false } = {}) {
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
    devices, client: { call: async (method, args) => { calls.push(method); if (method === 'prepare') { await beforePrepare?.(); return { main: 'D:/test-library/generated/main.ecs', manifest: 'manifest.json', targetSpeciesId: 42 }; } calls.push({ finalize: args }); return calibrationResult; }, close: () => {} },
    userData: 'D:/test-data', store, log: (...args) => { logs.push(args[0]); logRows.push(args); }, notifications: { wantsTaskImage, notifyTask: async (...args) => calls.push(args) },
    captureImage, encodeNotificationImage,
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

test('pokedex completion requires the enabled option and confirmed target evidence', async () => {
  for (const [enabled, data, evidence] of [
    [true, { result: '目标出闪', shiny: true, observedDex: 42 }, 'target_shiny'],
    [true, { result: '完整命中', targetHit: true }, 'full_target_hit'],
    [false, { result: '目标出闪', shiny: true, observedDex: 42 }, null],
    [true, { result: '目标出闪', shiny: true, observedDex: 25 }, null],
    [true, { result: '非目标出闪', shiny: true, observedDex: 19 }, null],
    [true, { result: '发现闪光', shiny: true }, null],
    [true, { result: '已反查', frameError: 0 }, null],
    [true, {}, null],
  ]) {
    const h = harness();
    await h.invoke('start', { request: plan.request, profileId: 'save-a', options: { auto_complete_pokedex: enabled } });
    h.events.emit('script', { event: 'script.round', runId: 'script1', number: 1, data });
    assert.equal((await h.invoke('state')).dexCompletion, null, 'running is not completed');
    h.done(); await h.service.settled();
    const state = await h.invoke('state');
    assert.equal(state.profileId, 'save-a');
    assert.deepEqual(state.dexCompletion, evidence ? { speciesId: 42, evidence } : null);
    assert.equal(h.calls.includes('finalize'), false, 'pokedex is independent of calibration updates');
  }
});

test('failed, stopped and foreign-script target observations never complete the pokedex', async () => {
  for (const mode of ['failed', 'stopped', 'foreign']) {
    const h = harness({ outcome: mode === 'failed' ? 'failed' : 'completed' });
    await h.invoke('start', { request: plan.request, profileId: 'save-a', options: { auto_complete_pokedex: true } });
    h.events.emit('script', { event: 'script.round', runId: mode === 'foreign' ? 'other' : 'script1', number: 1,
      data: { result: '目标出闪', shiny: true, observedDex: 42 } });
    if (mode === 'stopped') await h.invoke('stop'); else h.done();
    await h.service.settled();
    assert.equal((await h.invoke('state')).dexCompletion, null);
  }
});

test('new runs clear prior pokedex success and duplicate patches produce a single completion log', async () => {
  const h = harness();
  await h.invoke('start', { request: plan.request, profileId: 'save-a', options: { auto_complete_pokedex: true } });
  for (let n = 0; n < 2; n++) h.events.emit('script', { event: 'script.round', runId: 'script1', number: 1,
    data: { result: '目标出闪', shiny: true, observedDex: 42 } });
  h.done(); await h.service.settled();
  assert.equal(h.logs.filter(line => line.includes('自动标记本次存档')).length, 1);
  await h.invoke('start', { request: plan.request, profileId: 'save-b', options: { auto_complete_pokedex: true } });
  assert.equal((await h.invoke('state')).dexCompletion, null);
  h.done(); await h.service.settled();
  assert.equal((await h.invoke('state')).dexCompletion, null);
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

test('target shiny marker reaches finalize and reports its evidence without a reverse result', async () => {
  const h = harness({ calibrationResult: { calibrationUpdated: true,
    record: { seed_ns2: 3, frame_ns2: -6, evidence: { kind: 'target_shiny' } } } });
  await h.invoke('start', { request: plan.request, profileId: 'save-a', options: { update_precalibration: true } });
  const marker = 'PRECALIBRATION_UPDATE|V=1|GAME=FR|NX=2|MODE=8|STARTUP=0|ENTRY=FORMAL|KIND=WILD|SEED_INDEX=3|FRAME_PRE=-6|FRAME_ENABLED=1|EVIDENCE=TARGET_SHINY|TARGET_DEX=25|OBSERVED_DEX=25';
  h.events.emit('script', { event: 'script.log', runId: 'script1', message: marker });
  h.done(); await h.service.settled();
  assert.equal(h.calls.find(call => call?.finalize)?.finalize.log, marker);
  assert.ok(h.logs.includes('当前存档的预校准已更新（来自目标出闪时的执行修正）。'));
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

test('target shiny retains its detection frame through recording, calibration and final notification', async () => {
  const frames = [];
  const h = harness({ wantsTaskImage: () => true, captureImage: async () => { frames.push('battle'); return Buffer.from('battle'); },
    encodeNotificationImage: bytes => Buffer.concat([Buffer.from('jpeg:'), bytes]) });
  await h.invoke('start', { request: { ...plan.request, pokemon: 'Pikachu' }, profileId: 'save-a', options: { update_precalibration: false } });
  h.events.emit('script', { event: 'script.round', runId: 'other-script', number: 3, data: { shiny: true } });
  assert.equal(frames.length, 0);
  h.events.emit('script', { event: 'script.round', runId: 'script1', number: 3, data: { result: '发现闪光', shiny: true } });
  assert.deepEqual(frames, ['battle'], 'snapshot starts at observation, before the script finishes');
  h.events.emit('script', { event: 'script.log', runId: 'script1', message: '闪光录像：长按CAPTURE保存最近约30秒录像' });
  h.events.emit('script', { event: 'script.round', runId: 'script1', number: 3, data: { result: '目标出闪', shiny: true, observedDex: 25 } });
  h.done(); await h.service.settled(); await until(() => notificationsOf(h).length === 1);
  const notice = notificationsOf(h)[0];
  assert.deepEqual(notice.slice(1, 3), ['火叶自动乱数', 'completed']);
  assert.equal(notice[3].target, 'Pikachu'); assert.equal(notice[3].result, '目标出闪');
  assert.match(notice[3].detail, /第 3 轮目标出闪.*25/);
  assert.deepEqual(notice[3].image, Buffer.from('jpeg:battle'));
  assert.equal(frames.length, 1); assert.equal(h.calls.includes('finalize'), false);
  assert.match((await h.invoke('state')).message, /目标出闪/);
});

test('a shiny without species evidence remains a shiny observation, and non-target evidence is explicit', async () => {
  const h = harness();
  await h.invoke('start', { request: plan.request, profileId: 'save-a' });
  h.events.emit('script', { event: 'script.round', runId: 'script1', number: 1, data: { result: '发现闪光', shiny: true } });
  h.events.emit('script', { event: 'script.round', runId: 'script1', number: 1, data: { result: '非目标出闪', shiny: true, observedDex: 19 } });
  h.done(); await h.service.settled(); await until(() => notificationsOf(h).length === 1);
  assert.equal(notificationsOf(h)[0][3].result, '非目标出闪');
  assert.match(notificationsOf(h)[0][3].detail, /图鉴编号 19/);
  const unknown = harness();
  await unknown.invoke('start', { request: plan.request, profileId: 'save-a' });
  unknown.events.emit('script', { event: 'script.round', runId: 'script1', number: 1, data: { result: '发现闪光', shiny: true } });
  unknown.done(); await unknown.service.settled(); await until(() => notificationsOf(unknown).length === 1);
  assert.equal(notificationsOf(unknown)[0][3].result, '发现闪光');
});

test('ordinary completion captures its end frame but never reports predicted shininess as observed', async () => {
  let captures = 0;
  const h = harness({ wantsTaskImage: () => true, captureImage: async () => { captures++; return Buffer.from('end-frame'); } });
  await h.invoke('start', { request: { ...plan.request, shiny: 'Star/Square' }, profileId: 'save-a' });
  h.events.emit('script', { event: 'script.log', runId: 'script1', message: '【出闪检测】' });
  h.events.emit('script', { event: 'script.round', runId: 'script1', number: 1, data: { result: '已反查' } });
  assert.equal(captures, 0);
  h.done(); await h.service.settled(); await until(() => notificationsOf(h).length === 1);
  assert.equal(captures, 1); assert.equal(notificationsOf(h)[0][3].result, undefined);
  assert.deepEqual(notificationsOf(h)[0][3].image, Buffer.from('end-frame'));
});

test('screenshot failure preserves the shiny result and text delivery with a diagnostic', async () => {
  const h = harness({ wantsTaskImage: () => true, captureImage: async () => { throw Error('camera disconnected'); } });
  await h.invoke('start', { request: plan.request, profileId: 'save-a' });
  h.events.emit('script', { event: 'script.round', runId: 'script1', number: 2, data: { result: '目标出闪', shiny: true } });
  h.done(); await h.service.settled(); await until(() => notificationsOf(h).length === 1);
  assert.equal(notificationsOf(h)[0][3].image, undefined);
  assert.equal(notificationsOf(h)[0][3].result, '目标出闪');
  assert.ok(h.logRows.some(row => row[1] === 'QQ通知' && /截图失败.*camera disconnected/.test(row[0]) && row[3].round === 2));
  assert.equal((await h.invoke('state')).status, 'completed');
});

test('disabling task images avoids capture while retaining observed results', async () => {
  const h = harness({ captureImage: () => { assert.fail('disabled screenshot accessed the camera'); } });
  await h.invoke('start', { request: plan.request, profileId: 'save-a' });
  h.events.emit('script', { event: 'script.round', runId: 'script1', number: 1, data: { result: '目标出闪', shiny: true } });
  h.done(); await h.service.settled(); await until(() => notificationsOf(h).length === 1);
  assert.equal(notificationsOf(h)[0][3].result, '目标出闪');
  assert.equal(notificationsOf(h)[0][3].image, undefined);
});

test('failure-only notifications retain a detected shiny frame without claiming task success', async () => {
  const h = harness({ outcome: 'failed', wantsTaskImage: outcome => outcome === 'failed', captureImage: () => Buffer.from('shiny-before-error') });
  await h.invoke('start', { request: plan.request, profileId: 'save-a' });
  h.events.emit('script', { event: 'script.round', runId: 'script1', number: 1, data: { result: '目标出闪', shiny: true } });
  h.done(); await h.service.settled(); await until(() => notificationsOf(h).length === 1);
  assert.equal(notificationsOf(h)[0][2], 'failed');
  assert.equal(notificationsOf(h)[0][3].result, undefined);
  assert.deepEqual(notificationsOf(h)[0][3].image, Buffer.from('shiny-before-error'));
  assert.match(notificationsOf(h)[0][3].detail, /执行失败.*目标出闪/);
});

test('a slow screenshot never delays stop or mixes a subsequent run into the old notification', async () => {
  let resolveFrame, captures = 0;
  const frame = new Promise(resolve => { resolveFrame = resolve; });
  const h = harness({ wantsTaskImage: () => true, captureImage: () => ++captures === 1 ? frame : Buffer.from('next-run') });
  await h.invoke('start', { request: { ...plan.request, pokemon: 'Pikachu' }, profileId: 'save-a' });
  h.events.emit('script', { event: 'script.round', runId: 'script1', number: 3, data: { result: '目标出闪', shiny: true } });
  await h.invoke('stop');
  assert.equal(h.locked(), false); assert.equal(notificationsOf(h).length, 0);
  await h.invoke('start', { request: plan.request, profileId: 'save-b' });
  h.done(); await h.service.settled(); await until(() => notificationsOf(h).length === 1);
  resolveFrame(Buffer.from('old-shiny'));
  await until(() => notificationsOf(h).length === 2);
  const old = notificationsOf(h).find(row => row[3].target === 'Pikachu');
  assert.equal(old[2], 'stopped'); assert.equal(old[3].result, undefined);
  assert.match(old[3].detail, /已停止.*目标出闪/);
  assert.deepEqual(old[3].image, Buffer.from('old-shiny'));
  assert.deepEqual(notificationsOf(h).find(row => row[3].target === 'Golbat')[3].image, Buffer.from('next-run'));
});
