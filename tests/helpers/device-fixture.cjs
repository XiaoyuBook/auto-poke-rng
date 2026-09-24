const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { RuntimeClient } = require('../../electron/runtime-client.cjs');

const root = path.resolve(__dirname, '../..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(predicate, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  do {
    if (await predicate()) return;
    await delay(20);
  } while (Date.now() < deadline);
  throw new Error(message);
}

// Replace only OS keyboard capture, never the input manager's business logic.
function fakeKeyboard() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.commands = [];
  child.exitCode = null;
  child.message = message => child.stdout.write(JSON.stringify(message) + '\n');
  child.exit = () => {
    if (child.exitCode !== null) return;
    child.exitCode = 0;
    child.emit('exit', 0);
  };
  child.kill = child.exit;
  child.stdin = new Writable({ write(data, _encoding, done) {
    for (const line of data.toString().trim().split('\n')) {
      const command = JSON.parse(line);
      child.commands.push(command);
      if (command.command === 'start') queueMicrotask(() => child.message({ event: 'ready' }));
      if (command.command === 'stop') queueMicrotask(child.exit);
    }
    done();
  } });
  return child;
}

function createDeviceFixture(t) {
  const clients = {}, handlers = new Map(), events = [], modules = new Map();
  const webContents = { mainFrame: {}, isDestroyed: () => false,
    send: (channel, data) => events.push({ channel, data }) };
  const mainWindow = { webContents, isDestroyed: () => false };
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  let healthChecks = 0;
  class TrackedRuntimeClient extends RuntimeClient {
    constructor(options) { super(options); clients[options.role] = this; }
  }
  const electron = {
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    BrowserWindow: class { constructor() { throw new Error('This fixture must not open real windows'); } },
  };
  function load(name) {
    const filename = path.join(root, 'electron', name);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const originalRequire = createRequire(filename);
    const requireForTest = dependency => {
      if (dependency === 'electron') return electron;
      if (dependency === './runtime-client.cjs') return { RuntimeClient: TrackedRuntimeClient };
      if (dependency === './controller-overlay.cjs' || dependency === './controller-input.cjs') return load(dependency.slice(2));
      if (name === 'controller-input.cjs' && dependency === 'node:child_process') {
        return { ...originalRequire(dependency), spawn: fakeKeyboard };
      }
      return originalRequire(dependency);
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, exports: module.exports, require: requireForTest, __dirname: path.dirname(filename),
      __filename: filename, process, console, Buffer, AbortSignal,
      setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
      fetch: (...args) => {
        if (args[1]?.method === 'HEAD') ++healthChecks;
        return fetch(...args);
      },
    }, { filename });
    return module.exports;
  }
  const devices = load('devices.cjs').registerDevices({
    ipcMain: electron.ipcMain, getWindows: () => [mainWindow], testMode: true,
  });
  t.after(async () => {
    await devices.close();
    assert.equal(events.filter(e => e.channel === 'controller-overlay:error').length, 0,
      'fixture must not hide input errors');
  });
  const call = (name, args) => handlers.get(name)(event, args);
  return {
    devices, clients, call, events, input: devices.controllerOverlay.input,
    get healthChecks() { return healthChecks; },
    async connectController() { await call('controller:connect', { port: 'mock' }); },
    async activateKeyboard(mapping = { A: 'KeyL', B: 'KeyB' }) {
      const input = devices.controllerOverlay.input;
      input.setMapping(mapping);
      await input.toggle();
      assert.equal(input.getState().active, true);
      return input.child;
    },
    async connectVideo() {
      const config = { deviceId: 'synthetic', backend: 'msmf', width: 320, height: 240, fps: 30 };
      await call('video:connect', config);
      await until(() => devices.getState().video.status === 'connected', 'synthetic video did not connect');
      return { config, state: devices.getState().video };
    },
  };
}

module.exports = { createDeviceFixture, until };
