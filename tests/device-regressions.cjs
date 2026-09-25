// These assert the required behavior, not the observed bugs. Known defects are
// intentionally ordinary failing tests until fixed; see docs/DEVICE_REGRESSIONS.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDeviceFixture, until } = require('./helpers/device-fixture.cjs');
const neutral = { buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 };
const options = { timeout: 15000, skip: process.platform !== 'win32' };

test('live test captures do not publish or replace the reference snapshot', options, async t => {
  const f = createDeviceFixture(t);
  await f.connectVideo();
  const reference = await f.call('video:snapshot');
  const published = () => f.events.filter(event => event.channel === 'video:snapshot-updated');
  assert.equal(published().length, 1);
  const live = await f.call('video:capture-frame');
  assert.equal(live.session, reference.session);
  assert.match(live.url, /^data:image\/png;base64,/);
  assert.equal(published().length, 1);
  assert.deepEqual(await f.call('video:get-snapshot'), reference);
  const updated = await f.call('video:snapshot');
  assert.equal(published().length, 2);
  assert.deepEqual(await f.call('video:get-snapshot'), updated);
});

test('[DEV-001] a manual held key is released across a public short-press handoff', options, async t => {
  const f = createDeviceFixture(t);
  await f.connectController();
  const keyboard = await f.activateKeyboard();
  keyboard.message({ event: 'key', vk: 76, down: true });
  await f.input.pending;
  assert.equal((await f.clients.controller.call('controller.status')).report.buttons, 4);
  await f.call('controller:press', { key: 'B' });
  keyboard.message({ event: 'key', vk: 76, down: false });
  await f.input.pending;
  assert.deepEqual((await f.clients.controller.call('controller.status')).report, neutral,
    'A must not remain pressed after input handoff and physical key-up');
});

test('[DEV-001-GUARD] an owned script can hold A across a wait-only sequence', options, async t => {
  const f = createDeviceFixture(t);
  await f.connectController();
  const { owner } = await f.clients.controller.call('controller.acquire');
  await f.clients.controller.call('controller.key', { owner, key: 'A', down: true });
  await f.clients.controller.sequence({ owner, actions: [{ kind: 'wait', duration_ms: 35 }] });
  assert.equal((await f.clients.controller.call('controller.status')).report.buttons, 4,
    'fixing manual handoff must not reset every script sequence');
  await f.clients.controller.call('controller.release', { owner });
  assert.deepEqual((await f.clients.controller.call('controller.status')).report, neutral);
});

test('[DEV-002] renderer-failure cleanup disables capture and rejects later buffered keys', options, async t => {
  const f = createDeviceFixture(t);
  await f.connectController();
  const keyboard = await f.activateKeyboard();
  keyboard.message({ event: 'key', vk: 76, down: true });
  await f.input.pending;
  // main.cjs invokes this exact cleanup entry on render-process-gone.
  await f.devices.stopInputs();
  const activeAfterStop = f.input.getState().active;
  keyboard.message({ event: 'key', vk: 66, down: true });
  await f.input.pending;
  assert.deepEqual((await f.clients.controller.call('controller.status')).report, neutral,
    'a key buffered by the old input source must not reach the controller after cleanup');
  assert.equal(activeAfterStop, false, 'keyboard input must stay disabled until explicitly reactivated');
  assert.equal(f.input.child, null, 'renderer failure must also stop the OS keyboard hook');
  assert.notEqual(keyboard.exitCode, null);
});

test('[DEV-003] a duplicate video connection preserves the active session and health checks', options, async t => {
  const f = createDeviceFixture(t);
  const { config, state } = await f.connectVideo();
  // Either an idempotent success or a BUSY rejection is acceptable; neither
  // may turn the existing, healthy connection into a failed connection.
  await f.call('video:connect', config).catch(error => assert.equal(error.code, 'BUSY'));
  assert.equal(f.devices.getState().video.status, 'connected',
    'rejecting a duplicate request must not overwrite the existing connection state');
  assert.equal(f.devices.getState().video.session, state.session);
  assert.equal((await f.clients.video.call('video.status')).session, state.session);
  const snapshot = await f.call('video:snapshot');
  assert.equal(snapshot.session, state.session);
  const checks = f.healthChecks;
  await until(() => f.healthChecks > checks, 'duplicate connect disabled the active health monitor');
  await f.call('video:disconnect');
  assert.equal(f.devices.getState().video.status, 'idle');
});

test('[DEV-005] releasing a diagonal preserves a separately held cardinal direction', options, async t => {
  const f = createDeviceFixture(t);
  await f.connectController();
  for (const [key, down] of [['UP', true], ['UP_RIGHT', true], ['UP_RIGHT', false]]) {
    await f.call('controller:key', { key, down });
  }
  assert.equal((await f.clients.controller.call('controller.status')).report.hat, 0,
    'UP is still held after UP_RIGHT is released');
  await f.call('controller:key', { key: 'UP', down: false });
  assert.equal((await f.clients.controller.call('controller.status')).report.hat, 8);
});
