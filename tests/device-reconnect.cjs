const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDeviceReconnect } = require('../electron/device-reconnect.cjs');

const video = { deviceId: 'capture', backend: 'dshow', width: 1280, height: 720, fps: 60 };
function fixture(t, options = {}) {
  const userData = options.userData || fs.mkdtempSync(path.join(os.tmpdir(), 'poke-connections-'));
  if (!options.userData) t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const state = { video: { status: 'idle' }, controller: { status: 'idle' }, audio: { status: 'idle' } };
  const calls = [], published = [], items = {
    video: [{ id: 'capture', name: 'Capture' }], controller: [{ id: 'COM3', name: 'COM3' }], audio: [{ id: 'audio', name: 'Capture audio' }],
  };
  let coordinator, session = 0, blocked = false;
  const update = (kind, value) => { state[kind] = value; coordinator.observe(kind, value); };
  const connect = (kind, config) => coordinator.trackConnect(kind, config, async () => {
    calls.push(kind);
    update(kind, { status: 'connecting' });
    if (options.defer === kind) return;
    update(kind, { status: 'connected', session: String(++session),
      ...(kind === 'controller' ? { name: config.port } : { deviceId: config.deviceId, name: 'Capture', width: 640, height: 480 }) });
  });
  coordinator = createDeviceReconnect({
    userData, getState: () => state, list: options.list || (async kind => items[kind]), connect, isBusy: () => blocked,
    failDevice: (kind, error) => update(kind, { status: 'failed', message: error.message }),
    publish: value => published.push(value), timeout: options.timeout || 1000,
  });
  t.after(() => coordinator.close());
  return { userData, coordinator, state, calls, items, published, connect, update, block: () => { blocked = true; } };
}
async function remember(f) {
  await f.connect('video', video);
  await f.connect('controller', { port: 'COM3' });
  f.update('video', { status: 'idle' }); f.update('controller', { status: 'idle' });
  f.calls.length = 0;
}

test('first frame confirms persistence, requested parameters survive negotiation, and runtime credentials are excluded', async t => {
  const f = fixture(t, { defer: 'video' });
  await f.connect('video', { ...video, token: 'do-not-store', session: 'old' });
  assert.equal(f.coordinator.getState().preferences.video, undefined);
  f.update('video', { status: 'connected', deviceId: 'capture', name: 'Capture', width: 640, height: 480, token: 'secret', session: 'live' });
  assert.deepEqual(f.coordinator.getState().preferences.video, { ...video, name: 'Capture' });
  const disk = fs.readFileSync(path.join(f.userData, 'device-connections.json'), 'utf8');
  assert.doesNotMatch(disk, /token|session|secret/);
  f.update('video', { status: 'idle' });
  const reopened = fixture(t, { userData: f.userData });
  assert.deepEqual(reopened.coordinator.getState().preferences.video, { ...video, name: 'Capture' });
});

test('failed and cancelled drafts cannot overwrite a successful remembered device', async t => {
  const f = fixture(t);
  await remember(f);
  await assert.rejects(f.coordinator.trackConnect('video', { ...video, deviceId: 'wrong' }, async () => { throw Error('wrong device'); }), /wrong/);
  assert.equal(f.coordinator.getState().preferences.video.deviceId, 'capture');
  await f.coordinator.trackConnect('video', { ...video, deviceId: 'late' }, async () => {});
  f.coordinator.cancel('video');
  f.update('video', { status: 'connected', deviceId: 'late' });
  assert.equal(f.coordinator.getState().preferences.video.deviceId, 'capture');
});

test('missing serial port produces one named failure and retry preserves the video session', async t => {
  const f = fixture(t); await remember(f);
  f.items.controller = [{ id: 'COM7', name: 'Another controller' }];
  const failed = await f.coordinator.reconnect();
  assert.equal(failed.failures.length, 1);
  assert.equal(failed.failures[0].device, 'controller');
  assert.match(failed.failures[0].message, /COM3/);
  assert.equal(f.state.controller.status, 'failed');
  assert.equal(f.state.video.status, 'connected');
  const session = f.state.video.session;
  assert.deepEqual(f.calls, ['video']);
  f.items.controller = [{ id: 'COM3' }];
  assert.deepEqual((await f.coordinator.reconnect()).failures, []);
  assert.equal(f.state.video.session, session);
  assert.deepEqual(f.calls, ['video', 'controller']);
});

test('duplicate requests share a batch and wait for connected instead of a start acknowledgement', async t => {
  const seed = fixture(t); await remember(seed);
  const f = fixture(t, { userData: seed.userData, defer: 'video' });
  const first = f.coordinator.reconnect(), second = f.coordinator.reconnect();
  assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.coordinator.getState().busy, true);
  assert.equal(f.coordinator.getState().result, null);
  f.update('video', { status: 'connected', deviceId: 'capture', name: 'Capture' });
  assert.deepEqual((await first).failures, []);
  assert.deepEqual(f.calls.sort(), ['controller', 'video']);
});

test('running tasks are preserved and unconfigured audio never selects a microphone', async t => {
  const f = fixture(t); await remember(f); f.block();
  const result = await f.coordinator.reconnect();
  assert.equal(result.failures.length, 2); assert.deepEqual(f.calls, []);
  assert.equal(f.state.video.status, 'idle'); assert.equal(f.state.audio.status, 'idle');
});

test('startup preference survives reopening and starts at most once', async t => {
  const f = fixture(t); await remember(f);
  f.coordinator.savePreferences({ autoReconnect: true });
  const reopened = fixture(t, { userData: f.userData });
  reopened.coordinator.start(); reopened.coordinator.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(reopened.calls.sort(), ['controller', 'video']);
  assert.equal(reopened.coordinator.getState().preferences.autoReconnect, true);
});

test('damaged records and unknown versions degrade to an empty configuration', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.userData, 'device-connections.json'), '{bad');
  const reopened = fixture(t, { userData: f.userData });
  const result = await reopened.coordinator.reconnect();
  assert.match(result.message, /尚无上次连接/); assert.deepEqual(reopened.calls, []);
});

test('explicit cancellation releases a pending batch without a failure notice', async t => {
  const seed = fixture(t); await remember(seed);
  const f = fixture(t, { userData: seed.userData, defer: 'video' });
  const run = f.coordinator.reconnect();
  await new Promise(resolve => setImmediate(resolve));
  f.coordinator.cancel('video'); f.update('video', { status: 'idle' });
  assert.deepEqual((await run).failures, []);
  assert.equal(f.coordinator.getState().busy, false);
});

test('manual disconnect during enumeration prevents a late reconnect', async t => {
  const seed = fixture(t); await remember(seed);
  let finish;
  const enumeration = new Promise(resolve => { finish = resolve; });
  const f = fixture(t, { userData: seed.userData, list: kind => kind === 'video' ? enumeration : [{ id: 'COM3' }] });
  const run = f.coordinator.reconnect();
  await new Promise(resolve => setImmediate(resolve));
  f.coordinator.cancel('video');
  finish([{ id: 'capture' }]);
  assert.deepEqual((await run).failures, []);
  assert.equal(f.state.video.status, 'idle');
  assert.deepEqual(f.calls, ['controller']);
});

test('a start acknowledgement without a connected state times out with a persistent failure', async t => {
  const seed = fixture(t); await remember(seed);
  const f = fixture(t, { userData: seed.userData, defer: 'video', timeout: 20 });
  const result = await f.coordinator.reconnect();
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].device, 'video');
  assert.match(result.failures[0].message, /超时/);
  assert.equal(f.state.video.status, 'failed');
  assert.equal(f.state.controller.status, 'connected');
  assert.deepEqual(f.coordinator.getState().preferences.video, { ...video, name: 'Capture' });
});
