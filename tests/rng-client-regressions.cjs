const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { RuntimeClient } = require('../electron/runtime-client.cjs');
const { registerRng, MAX_RESULTS } = require('../electron/rng-client.cjs');
function setup(client, calculator) {
  const sender = new EventEmitter(); sender.mainFrame = {};
  const event = { sender, senderFrame: sender.mainFrame };
  const handlers = {};
  const service = registerRng({ ipcMain: { handle: (name, handler) => { handlers[name] = handler; } }, getMainWindow: () => ({ webContents: sender }), client, calculator });
  return { service, sender, generate: request => handlers['rng:static-generate'](event, request), calculate: request => handlers['rng:iv-calculate'](event, request), cancel: () => handlers['rng:cancel'](event), handlers };
}
const request = (overrides = {}) => ({ seed0: '1234567887654321', seed1: '8765432112345678', initialAdvances: 0, maxAdvances: 0, offset: 0, lead: 255, target: 'Turtwig', profile: { version: 'BD', tid: 12345, sid: 54321 }, filter: {}, ...overrides });

test('batch boundaries are inclusive, preserve offset, and never truncate the original 100000-frame default', async () => {
  const calls = [];
  const api = setup({ call: async (_, args) => { calls.push(args); return Array.from({ length: args.maxAdvances + 1 }, (_, i) => ({ advances: args.initialAdvances + i })); }, close: async () => {} });
  assert.equal((await api.generate(request({ initialAdvances: 42 }))).length, 1);
  const rows = await api.generate(request({ initialAdvances: 10, maxAdvances: 100000, offset: 99 }));
  assert.equal(rows.length, 100001);
  assert.equal(rows[4095].advances, 4105); assert.equal(rows[4096].advances, 4106);
  assert.equal(rows.at(-1).advances, 100010);
  assert.ok(calls.slice(1).every(args => args.offset === 99 && args.seed1 === '8765432112345678'));
  assert.equal(api.sender.listenerCount('destroyed'), 0);
  assert.equal(api.sender.listenerCount('render-process-gone'), 0);
});
test('batched real native results match a direct search across both batch boundaries', async () => {
  const client = new RuntimeClient({ role: 'rng' });
  const api = setup(client);
  try {
    const rows = await api.generate(request({ initialAdvances: 21, maxAdvances: 8200, offset: 17 }));
    assert.equal(rows.length, 8201);
    const direct = await client.call('static.generate', request({ initialAdvances: 4114, maxAdvances: 8, offset: 17 }));
    assert.deepEqual(rows.slice(4093, 4102), direct);
    assert.deepEqual(rows.slice(8189, 8198), await client.call('static.generate', request({ initialAdvances: 8210, maxAdvances: 8, offset: 17 })));
  } finally { await api.service.close(); }
});
test('result guard fails visibly without returning an incomplete success', async () => {
  const api = setup({ call: async () => Array(4096).fill({}), close: async () => {} });
  await assert.rejects(api.generate(request({ maxAdvances: MAX_RESULTS + 4096 })), /结果超过 250,000/);
});
test('cancelling kills only the RNG client, rejects the search, and allows a subsequent search', async () => {
  let rejectPending;
  let terminations = 0;
  const client = { call: () => new Promise((_, reject) => { rejectPending = reject; }), terminate: () => { terminations++; rejectPending(new Error('runtime exited')); }, close: async () => {} };
  const api = setup(client);
  const failed = assert.rejects(api.generate(request({ maxAdvances: 1000000000 })), /已取消搜索/);
  await assert.rejects(api.generate(request()), /已有定点搜索/);
  await api.cancel(); await failed;
  assert.equal(terminations, 1);
  client.call = async () => [];
  assert.deepEqual(await api.generate(request()), []);
});
test('real cancellation waits for child exit before permitting immediate retry', async () => {
  const api = setup(new RuntimeClient({ role: 'rng' }));
  try {
    for (let i = 0; i < 3; i++) {
      const failed = assert.rejects(api.generate(request({ maxAdvances: 1000000000, filter: { natures: Array(25).fill(false) } })), /已取消搜索/);
      await api.cancel(); await failed;
      assert.equal((await api.generate(request())).length, 1);
    }
  } finally { await api.service.close(); }
});
test('destroyed owner cancels its search and another window or subframe cannot invoke RNG', async () => {
  let rejectPending;
  const api = setup({ call: () => new Promise((_, reject) => { rejectPending = reject; }), terminate: () => rejectPending(new Error('exit')), close: async () => {} });
  const failed = assert.rejects(api.generate(request()), /已取消搜索/);
  api.sender.emit('destroyed'); await failed;
  const crashed = assert.rejects(api.generate(request()), /已取消搜索/);
  api.sender.emit('render-process-gone'); await crashed;
  await assert.rejects(api.handlers['rng:static-generate']({ sender: {}, senderFrame: {} }, request()), /Unknown RNG sender/);
  await assert.rejects(api.handlers['rng:cancel']({ sender: api.sender, senderFrame: {} }), /Unknown RNG sender/);
});
test('missing native runtime and invalid ranges fail explicitly with no simulated fallback', async () => {
  const api = setup(new RuntimeClient({ role: 'rng', executable: 'D:/does-not-exist/poke-runtime.exe' }));
  await assert.rejects(api.generate(request()), /尚未构建/);
  for (const overrides of [{ maxAdvances: -1 }, { maxAdvances: 1000000001 }, { initialAdvances: 10000001 }, { offset: 1000001 }, { offset: 0.5 }]) await assert.rejects(api.generate(request(overrides)), /必须在/);
  await api.service.close();
});
test('IV calculation has sender isolation and survives cancelling a concurrent static search', async () => {
  let rejectSearch, finishCalculation;
  let calculatorClosed = false;
  const input = { species: 65, entries: [{ level: 5, stats: [22,9,11,22,16,18] }] };
  const api = setup({ call: () => new Promise((_, reject) => { rejectSearch = reject; }), terminate: () => rejectSearch(new Error('exit')), close: async () => {} }, {
    call: (command, args) => { assert.equal(command, 'iv.calculate'); assert.deepEqual(args, input); return new Promise(resolve => { finishCalculation = resolve; }); },
    close: async () => { calculatorClosed = true; },
  });
  await assert.rejects(api.handlers['rng:iv-calculate']({ sender: {}, senderFrame: {} }, input), /Unknown RNG sender/);
  await assert.rejects(api.handlers['rng:iv-calculate']({ sender: api.sender, senderFrame: {} }, input), /Unknown RNG sender/);
  const search = assert.rejects(api.generate(request()), /已取消搜索/);
  const calculation = api.calculate(input);
  await api.cancel(); await search;
  assert.equal(calculatorClosed, false);
  finishCalculation({ possible: true });
  assert.deepEqual(await calculation, { possible: true });
  await api.service.close(); assert.equal(calculatorClosed, true);
});
