const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { registerBlink, validateConfig, readBlinkConfig } = require('../electron/blink-client.cjs');

const videoState = () => ({ status: 'connected', session: 'one', width: 1920, height: 1080, sharedMemory: { mapping: 'trusted', version: 1 } });
const config = () => ({ mode: 'recover', eye: 'data:image/png;base64,AAAA', roi: { x: 100, y: 100, width: 50, height: 50 }, sourceWidth: 1920, sourceHeight: 1080, threshold: .9, npc: 0,
  noisy: false, seed: ['12345678', '87654321', '87654321', '12345678'], searchMin: 0, searchMax: 1000000 });
function setup() {
  const handlers = {}, sender = new EventEmitter(); sender.mainFrame = {}; sender.isDestroyed = () => false; sender.send = () => {};
  const window = { webContents: sender, isDestroyed: () => false };
  let video = videoState();
  const children = [];
  const service = registerBlink({ ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, getMainWindow: () => window, getVideo: () => video,
    spawnProcess: () => {
      const child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = () => { child.killed = true; setImmediate(() => child.emit('close')); };
      child.reply = message => child.stdout.write(JSON.stringify(message) + '\n');
      children.push(child); return child;
    } });
  const event = { sender, senderFrame: sender.mainFrame };
  return { service, handlers, sender, children, setVideo: value => { video = value; }, call: (method, args) => handlers[`blink:${method}`](event, args) };
}

test('Project_Xs deterministic original algorithm and frame regression suite', { timeout: 30000 }, () => {
  const root = path.resolve(__dirname, '..');
  const local = path.join(root, '.deps/script-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const result = spawnSync(process.env.AUTO_POKE_PYTHON || (fs.existsSync(local) ? local : 'python'), ['-X', 'utf8', '-m', 'unittest', 'discover', '-s', 'runtime/tests', '-p', 'test_blink*.py'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 25000 });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr);
});
test('all timing values reach the worker, and Timeline commands use the same running process', async () => {
  const timing = { timeDelay: .8, advanceDelay: 13, advanceDelay2: 27, timelineNpc: -1, pokemonNpc: 2, menuClose: false };
  assert.deepEqual(Object.fromEntries(Object.keys(timing).map(key => [key, validateConfig({ ...config(), ...timing }, videoState())[key]])), timing);
  for (const values of [{ timeDelay: -1 }, { advanceDelay: 1.5 }, { advanceDelay2: -1 }, { timelineNpc: -2 }, { pokemonNpc: NaN }]) assert.throws(() => validateConfig({ ...config(), ...values }, videoState()));
  const api = setup();
  try {
    await api.call('start', { ...config(), ...timing });
    let input = api.children[0].stdin.read().toString();
    assert.equal(JSON.parse(input).advanceDelay2, 27);
    assert.throws(() => api.call('timeline'), /先完成/);
    api.children[0].reply({ event: 'result', result: { pair: ['1234'], words: [] } });
    assert.equal(api.service.getState().status, 'tracking');
    api.call('timeline');
    input = api.children[0].stdin.read().toString();
    assert.deepEqual(JSON.parse(input), { command: 'timeline' });
    assert.equal(api.children.length, 1);
    api.children[0].reply({ event: 'tracking', tracking: { phase: 'timeline', advances: 53 } });
    assert.equal(api.service.getState().tracking.advances, 53);
    assert.equal(api.service.getState().status, 'timeline');
    await api.call('stop');
    assert.equal(api.service.getState().status, 'stopped');
  } finally { await api.service.close(); }
});
test('original configuration import preserves distinct timing parameters and does not replace video settings', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'blink-config-test-'));
  try {
    const filename = path.join(dir, 'cave.json');
    fs.writeFileSync(filename, JSON.stringify({ view: [10, 20, 40, 30], thresh: .92, npc: 1, white_delay: .8, advance_delay: 13, advance_delay_2: 27, timeline_npc: -1, pokemon_npc: 2, reident_1_pk_npc: true, camera: 99, crop: [0,0,0,0] }));
    const value = await readBlinkConfig(filename, videoState());
    assert.equal(value.timeDelay, .8); assert.equal(value.advanceDelay, 13); assert.equal(value.advanceDelay2, 27);
    assert.equal(value.timelineNpc, -1); assert.equal(value.pokemonNpc, 2); assert.equal(value.noisy, true);
    assert.equal(value.camera, undefined); assert.equal(value.sourceWidth, 1920);
    assert.deepEqual(value.roi, { x: 10, y: 20, width: 40, height: 30 });
    assert.equal((await readBlinkConfig(filename, { status: 'idle' })).roi, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('validation only permits trusted shared-frame descriptors and consistent configuration', () => {
  const request = config();
  request.video = { sharedMemory: { mapping: 'untrusted' } };
  assert.equal(validateConfig(request, videoState()).video.sharedMemory.mapping, 'trusted');
  for (const patch of [{ sourceWidth: 1280 }, { roi: { x: 1910, y: 0, width: 50, height: 10 } }, { threshold: NaN }, { npc: -1 }, { eye: '' }]) {
    assert.throws(() => validateConfig({ ...request, ...patch }, videoState()));
  }
  assert.throws(() => validateConfig(request, { status: 'idle' }), /连接/);
  assert.throws(() => validateConfig({ ...request, mode: 'reidentify', seed: ['0','0','0','0'] }, videoState()), /非全零/);
  assert.doesNotThrow(() => validateConfig({ ...request, mode: 'reidentify', noisy: true }, videoState()), 'upstream recommends a smaller noisy range but does not prohibit larger searches');
  assert.throws(() => validateConfig({ ...request, mode: 'reidentify', searchMin: 10, searchMax: 9 }, videoState()), /搜索范围/);
});
test('stop waits for process exit; no stale progress can overwrite a new job', async () => {
  const api = setup();
  try {
    await api.call('start', config());
    await assert.rejects(api.call('start', config()), /已有/);
    api.children[0].reply({ event: 'ready' });
    assert.equal(api.service.getState().status, 'capturing');
    const stopping = api.call('stop');
    api.children[0].reply({ event: 'result', result: { pair: ['BAD'] } });
    await stopping;
    assert.equal(api.service.getState().status, 'stopped');
    assert.equal(api.service.getState().result, null);
    await api.call('start', config());
    api.children[0].reply({ event: 'error', message: 'old job' });
    assert.equal(api.service.getState().status, 'starting');
  } finally { await api.service.close(); }
  assert.equal(api.sender.listenerCount('destroyed'), 0);
});
test('window close, source change, malformed protocol and spawn failure release the task', async () => {
  const api = setup();
  try {
    await api.call('start', config()); api.sender.emit('destroyed'); await api.call('stop');
    assert.equal(api.children[0].killed, true);
    await api.call('start', config()); api.setVideo({ ...videoState(), session: 'two' });
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(api.service.getState().status, 'error');
    assert.match(api.service.getState().message, /视频源/);
    await api.call('start', config()); api.children[2].stdout.write('invalid\n'); await api.call('stop');
    assert.equal(api.service.getState().status, 'error');
    await api.call('start', config()); api.children[3].emit('error', Error('ENOENT'));
    assert.match(api.service.getState().message, /ENOENT/);
    await api.call('start', config());
    api.children[3].emit('close');
    assert.equal(api.service.getState().status, 'starting', 'late close from failed spawn must not poison a retry');
    api.children[3].stdin.emit('error', Error('late pipe failure'));
    assert.equal(api.children[4].killed, undefined, 'old pipe must not stop the new worker');
  } finally { await api.service.close(); }
});
test('other windows and subframes cannot start, stop or read capture state', async () => {
  const api = setup();
  for (const method of ['state', 'start', 'stop', 'timeline', 'import-config']) {
    await assert.rejects(async () => api.handlers[`blink:${method}`]({ sender: {}, senderFrame: {} }, config()), /Unknown blink sender/);
    await assert.rejects(async () => api.handlers[`blink:${method}`]({ sender: api.sender, senderFrame: {} }, config()), /Unknown blink sender/);
  }
});
