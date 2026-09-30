const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerFrlgAutomation } = require('../electron/frlg-automation.cjs');
const plan = require('./fixtures/frlg-golbat-plan.json');

function harness({ beforePrepare, outcome = 'completed', immediateDone = false, connected = true } = {}) {
  const handlers = new Map(), events = new EventEmitter(), sent = [], logs = [], calls = [];
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
      start: async () => { running = true; if (immediateDone) events.emit('script', { event: 'script.done', runId: 'script1', status: outcome }); return { runId: 'script1' }; },
      stop: async () => { if (running) { running = false; events.emit('script', { event: 'script.done', runId: 'script1', status: 'cancelled' }); } },
    },
  };
  const service = registerFrlgAutomation({
    ipcMain: { handle: (name, action) => handlers.set(name, action) }, getMainWindow: () => ({ webContents: sender }),
    devices, client: { call: async (method) => { calls.push(method); if (method === 'prepare') { await beforePrepare?.(); return { main: 'D:/test-library/generated/main.ecs', manifest: 'manifest.json' }; } return { calibrationUpdated: true }; }, close: () => {} },
    userData: 'D:/test-data', log: message => logs.push(message), notifications: { notifyTask: async (...args) => calls.push(args) },
    readFile: async () => 'PRINT test', makeDirectory: async () => {},
  });
  const invoke = (name, args) => handlers.get('frlg-automation:' + name)(event, args);
  const done = () => events.emit('script', { event: 'script.done', runId: 'script1', status: outcome });
  return { service, invoke, done, events, calls, logs, handlers, locked: () => locked };
}

test('rejects duplicate starts and foreign IPC senders', async () => {
  const h = harness();
  await h.invoke('start', { request: plan.request, profileId: 'save-a' });
  assert.throws(() => h.invoke('start', { request: plan.request, profileId: 'save-b' }), /正在运行/);
  assert.throws(() => h.handlers.get('frlg-automation:stop')({ sender: {}, senderFrame: {} }), /sender/);
  await h.invoke('stop');
  assert.equal(h.locked(), false);
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
  assert.equal(h.locked(), true);
  h.events.emit('script', { event: 'script.log', runId: 'script1', message: '反查完成' });
  h.done();
  await h.service.settled();
  assert.equal(h.locked(), false);
  assert.ok(h.logs.includes('反查完成'));
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
