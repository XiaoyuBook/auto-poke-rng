const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { RuntimeClient } = require('../electron/runtime-client.cjs');
const { createDeviceFixture, until } = require('./helpers/device-fixture.cjs');
const options = { timeout: 20000, skip: process.platform !== 'win32' };
const request = (s, query = '') => fetch(`${s.baseUrl}/audio?session=${encodeURIComponent(s.session)}${query}`, {
  headers: { Authorization: 'Bearer ' + s.token }, signal: AbortSignal.timeout(2000),
});
async function connect(client, extra = {}) {
  let state;
  const onEvent = e => { if (e.event === 'audio.state') state = e.state; };
  client.on('event', onEvent);
  try {
    await client.call('audio.start', { deviceId: 'synthetic', ...extra });
    await until(() => ['connected', 'failed'].includes(state?.status), 'audio never connected');
    assert.equal(state.status, 'connected', state.message);
    return state;
  } finally { client.off('event', onEvent); }
}

test('native audio exposes authorized continuous stereo PCM and independent readers, silence and session invalidation', options, async t => {
  const client = new RuntimeClient({ role: 'audio', testMode: true });
  t.after(() => client.close());
  assert.ok((await client.call('audio.list')).some(x => x.id === 'synthetic'));
  const source = await connect(client);
  assert.equal(source.sampleRate, 48000); assert.equal(source.channels, 2);
  assert.equal((await fetch(source.baseUrl + '/audio')).status, 401);
  assert.equal((await request(source, '&after=-1')).status, 400);
  assert.equal((await request(source, '&mode=wrong')).status, 400);
  const first = await request(source), sequence = Number(first.headers.get('x-audio-sequence'));
  const bytes = Buffer.from(await first.arrayBuffer());
  assert.equal(bytes.length, 960 * 2 * 4);
  const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  assert.ok(samples.some(x => x > .24));
  for (let i = 0; i < samples.length; i += 2) assert.equal(samples[i], samples[i + 1]);
  const responses = await Promise.all([request(source, `&after=${sequence}&mode=next`), request(source, `&after=${sequence}&mode=next`)]);
  assert.equal(responses[0].headers.get('x-audio-sequence'), responses[1].headers.get('x-audio-sequence'));
  assert.deepEqual(Buffer.from(await responses[0].arrayBuffer()), Buffer.from(await responses[1].arrayBuffer()));
  await assert.rejects(client.call('audio.start', { deviceId: 'synthetic' }), { code: 'BUSY' });
  assert.equal((await client.call('audio.status')).session, source.session);
  const python = spawnSync(path.join(__dirname, '../.deps/script-python/Scripts/python.exe'), ['-c',
    'import sys,json; sys.path.insert(0,"runtime/clients"); from audio import Audio; a=Audio(json.loads(sys.argv[1])); x=a.read(); y=a.read(); assert y.sequence==x.sequence+1 and y.skipped==0; assert len(x.pcm)==x.frames*x.channels*4', JSON.stringify(source)],
    { encoding: 'utf8', timeout: 5000, windowsHide: true });
  assert.equal(python.status, 0, python.stderr);
  // A slow reader must skip expired history and report loss, not remain stuck
  // forever on the same stale block while fresh audio is available.
  await new Promise(resolve => setTimeout(resolve, 3200));
  const lagged = await request(source, `&after=${sequence}&mode=next`);
  assert.equal(lagged.status, 200);
  assert.ok(Number(lagged.headers.get('x-audio-skipped')) > 0);
  await lagged.arrayBuffer();
  await client.call('audio.stop');
  assert.equal((await request(source)).status, 503);
  const silent = await connect(client, { silent: true });
  assert.notEqual(silent.session, source.session);
  assert.equal((await request(source)).status, 409);
  const quiet = await request(silent);
  assert.equal(quiet.headers.get('x-audio-silent'), '1');
  assert.ok(Buffer.from(await quiet.arrayBuffer()).every(x => x === 0));
  assert.equal((await client.call('audio.status')).status, 'connected');
});

test('production rejects synthetic input and missing input cannot silently become the default microphone', options, async t => {
  const client = new RuntimeClient({ role: 'audio' }); t.after(() => client.close());
  await assert.rejects(client.call('audio.start', { deviceId: 'synthetic' }), /模拟音频/);
  await assert.rejects(client.call('audio.start', {}), /请选择/);
  let failed;
  client.on('event', e => { if (e.event === 'audio.state' && e.state.status === 'failed') failed = e.state; });
  await client.call('audio.start', { deviceId: 'not-a-real-endpoint' });
  await until(() => failed, 'missing endpoint must fail');
  assert.equal((await client.call('audio.status')).status, 'failed');
});

test('device IPC preserves duplicate sessions and audio survives dialog/video changes, process failure and reconnect', options, async t => {
  const f = createDeviceFixture(t);
  await f.call('audio:connect', { deviceId: 'synthetic' });
  await until(() => f.devices.getState().audio.status === 'connected', 'audio connect');
  const original = f.devices.getState().audio.session;
  await assert.rejects(async () => f.call('audio:connect', { deviceId: 'synthetic' }), { code: 'BUSY' });
  assert.equal(f.devices.getState().audio.session, original);
  await f.connectVideo();
  await f.call('video:disconnect');
  assert.equal(f.devices.getState().audio.session, original);
  await until(() => f.events.some(e => e.channel === 'devices:audio-level' && e.data.peak > .2), 'audio meter');
  f.clients.audio.terminate();
  await until(() => f.devices.getState().audio.status === 'failed', 'dead audio process');
  await f.call('audio:connect', { deviceId: 'synthetic' });
  await until(() => f.devices.getState().audio.status === 'connected', 'audio reconnect');
  assert.notEqual(f.devices.getState().audio.session, original);
  await f.call('audio:disconnect'); assert.equal(f.devices.getState().audio.status, 'idle');
  const pending = f.call('audio:connect', { deviceId: 'synthetic' });
  await f.call('audio:disconnect'); await pending;
  assert.equal(f.devices.getState().audio.status, 'idle', 'cancelled startup must not reconnect');
  assert.equal((await f.clients.audio.call('audio.status')).status, 'idle');
});
