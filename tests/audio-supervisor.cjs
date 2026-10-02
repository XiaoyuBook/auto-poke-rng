const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerAudio } = require('../electron/audio-devices.cjs');
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(t) {
  const handlers = new Map(); let state, sequence = 0;
  class Client extends EventEmitter {
    child = {}; kills = 0;
    async call(method) {
      if (method === 'audio.start') this.emit('event', { event: 'audio.state', state: {
        status: 'connected', session: `session-${++sequence}`, baseUrl: 'http://127.0.0.1:1', token: 'test-only',
      } });
    }
    terminate() { ++this.kills; this.child = null; this.emit('offline', Error('child exited')); }
    async close() { this.child = null; }
  }
  const client = new Client();
  const service = registerAudio({ client, handle: (name, fn) => handlers.set(name, fn), publish: value => { state = value; }, level: () => {} });
  t.after(() => service.close());
  return { client, call: (name, value) => handlers.get(name)(value), get state() { return state; } };
}

test('audio watchdog treats repeated block numbers as a stalled input and terminates only its own child', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  t.mock.method(global, 'fetch', async () => ({ ok: true, headers: new Headers({ 'x-audio-sequence': '10' }) }));
  const f = fixture(t);
  await f.call('audio:connect', { deviceId: 'card' });
  for (let i=0; i<6; ++i) { t.mock.timers.tick(1000); await settle(); }
  assert.equal(f.state.status, 'failed');
  assert.match(f.state.message, /没有新数据/);
  assert.equal(f.client.kills, 1);
});

test('a health failure from the old session cannot invalidate a newly connected source', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  let rejectHealth;
  t.mock.method(global, 'fetch', () => new Promise((_, reject) => { rejectHealth = reject; }));
  const f = fixture(t);
  await f.call('audio:connect', { deviceId: 'card' });
  const original = f.state.session;
  t.mock.timers.tick(1000);
  await f.call('audio:disconnect');
  await f.call('audio:connect', { deviceId: 'card' });
  rejectHealth(Error('old request timed out'));
  await settle();
  assert.equal(f.state.status, 'connected');
  assert.notEqual(f.state.session, original);
  assert.equal(f.client.kills, 0);
});

test('an accepted start without audio packets times out instead of claiming a connected input', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const f = fixture(t);
  f.client.call = async () => ({ accepted: true });
  await f.call('audio:connect', { deviceId: 'card' });
  assert.equal(f.state.status, 'connecting');
  t.mock.timers.tick(15000);
  assert.equal(f.state.status, 'failed');
  assert.match(f.state.message, /超时/);
  assert.equal(f.client.kills, 1);
});
