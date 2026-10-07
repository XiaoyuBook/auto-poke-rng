const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.platform !== 'win32') {
  console.log('SKIP: real global keyboard regression requires Windows.');
  app.exit(0);
} else {
  const root = path.resolve(__dirname, '..');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'poke-global-keyboard-'));
  app.setPath('userData', userData);
  Object.defineProperty(app, 'isPackaged', { value: true });
  process.env.AUTO_POKE_TEST_DEVICES = '1';
  // Load the complete production app: real preload, menu, overlay, keyboard
  // subprocess and C++ runtime. Only the serial device is a mock.
  require('../electron/main.cjs');

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  let probe;
  const events = [], errors = [], diagnostics = [];
  const until = async (predicate, label) => {
    const deadline = Date.now() + 5000;
    do {
      if (await predicate()) return;
      if (errors.length) throw new Error(errors.join('\n'));
      if (probe && probe.exitCode !== null) throw new Error(`Keyboard probe exited (${probe.exitCode}): ${diagnostics.join('')}`);
      await delay(20);
    } while (Date.now() < deadline);
    throw new Error(label);
  };
  const timeout = setTimeout(() => { probe?.kill(); console.error('Global keyboard test timeout'); app.exit(1); }, 30000);

  app.whenReady().then(async () => {
    try {
      let main;
      await until(() => { main = BrowserWindow.getAllWindows().find(window => window.isFocusable()); return main; }, 'main window created');
      const js = code => main.webContents.executeJavaScript(code, true);
      await until(async () => {
        try { return await js('Boolean(window.desktop?.overlay && document.querySelector(".controller-tools button"))'); }
        catch { return false; }
      }, 'production toolbar loaded');
      await js('window.desktop.devices.controller.connect("mock")');
      await until(() => js('document.querySelector(".controller-tools button").dataset.connectionStatus === "connected"'), 'mock connected');
      await js('window.desktop.overlay.setMapping({ A: "F24", LSUp: "F23" })');
      await js('document.querySelector(".controller-tools button").click()');
      await until(() => js('Boolean(document.querySelector(".controller-tools-menu"))'), 'controller menu opened');
      await js('[...document.querySelectorAll(".controller-tools-menu button")].find(button => button.textContent === "打开虚拟手柄").click()');
      const state = () => js('window.desktop.overlay.getState()');
      const report = () => js('window.desktop.devices.getState().then(state => state.controller.report)');
      await until(async () => (await state()).active, 'keyboard capture activated from toolbar');
      const overlay = BrowserWindow.getAllWindows().find(window => !window.isFocusable());
      assert.ok(overlay, 'transparent overlay exists and does not require focus');

      const localPython = path.join(root, '.deps/script-python/Scripts/python.exe');
      const python = process.env.AUTO_POKE_PYTHON || (fs.existsSync(localPython) ? localPython : 'python');
      probe = spawn(python, ['-u', path.join(__dirname, 'helpers/windows-keyboard-probe.py')], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUTF8: '1' },
      });
      let buffer = '';
      probe.on('error', error => errors.push(error.message));
      probe.stderr.on('data', data => diagnostics.push(data.toString()));
      probe.stdout.on('data', data => {
        buffer += data;
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const event = JSON.parse(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          events.push(event);
          if (event.event === 'error') errors.push(event.message);
        }
      });
      await until(() => events.some(event => event.event === 'ready'), 'independent foreground process ready');
      const ready = events.find(event => event.event === 'ready');
      assert.equal(ready.foreground, true, 'probe owns the real OS foreground');
      for (const window of BrowserWindow.getAllWindows()) {
        assert.notEqual(window.getNativeWindowHandle().readBigUInt64LE().toString(), String(ready.hwnd), 'foreground is outside every Electron window');
      }
      let id = 0;
      const key = async (vk, down) => {
        const next = ++id;
        probe.stdin.write(JSON.stringify({ id: next, vk, down }) + '\n');
        await until(() => events.some(event => event.event === 'sent' && event.id === next), 'native key injected');
        assert.equal(events.find(event => event.event === 'sent' && event.id === next).foreground, true, 'external process still owns foreground');
      };

      await key(0x87, true);
      await until(async () => (await report()).buttons === 4, 'background A down reaches C++ report');
      await key(0x86, true);
      await until(async () => (await report()).ly === 0, 'background left stick up reaches C++ report');
      await key(0x87, false);
      await until(async () => (await report()).buttons === 0, 'background A release');
      await key(0x86, false);
      await until(async () => (await report()).ly === 128, 'background stick release');
      assert.equal(events.filter(event => event.event === 'key' && [0x86, 0x87].includes(event.vk)).length, 0, 'active mapped keys are consumed before foreground window');
      await key(0x85, true); await key(0x85, false);
      await until(() => events.some(event => event.event === 'key' && event.vk === 0x85 && !event.down), 'unmapped keys pass to foreground');

      await key(0x1B, true); await key(0x1B, false);
      await until(async () => (await state()).mode === 'standby', 'global Esc enters standby');
      await key(0x87, true); await key(0x87, false);
      await until(() => events.some(event => event.event === 'key' && event.vk === 0x87 && !event.down), 'standby passes mapped keys to foreground');
      assert.equal((await report()).buttons, 0, 'standby does not send controller buttons');
      await key(0x1B, true); await key(0x1B, false);
      await until(async () => (await state()).active, 'global Esc reactivates capture');

      main.minimize();
      await until(() => main.isMinimized(), 'main window minimized');
      await key(0x87, true);
      await until(async () => (await report()).buttons === 4, 'minimized application still captures A');
      await key(0x87, false);
      await until(async () => (await report()).buttons === 0, 'minimized application releases A');
      await key(0xA2, true); await key(0x1B, true); await key(0x1B, false); await key(0xA2, false);
      await until(async () => !(await state()).visible, 'global Ctrl+Esc closes overlay');
      assert.equal(overlay.isDestroyed(), true, 'global close removes native overlay');
      await key(0x87, true); await key(0x87, false);
      await until(() => events.filter(event => event.event === 'key' && event.vk === 0x87 && !event.down).length === 2, 'closing restores foreground keyboard input');
      assert.equal((await report()).buttons, 0);
      assert.deepEqual(errors, []);
      console.log('PASS: real global keyboard via production toolbar, external foreground, button/stick press/release, mapped-key capture, unmapped-key passthrough, standby, minimized main window and global Esc/Ctrl+Esc.');
    } finally {
      clearTimeout(timeout);
      if (probe && probe.exitCode === null) {
        const exited = once(probe, 'exit');
        probe.stdin.end(JSON.stringify({ stop: true }) + '\n');
        await Promise.race([exited, delay(1500)]);
        if (probe.exitCode === null) { probe.kill(); await exited; }
      }
    }
    app.quit();
  }).catch(error => {
    console.error(error);
    // Let production cleanup finish, then preserve the failing test exit code.
    app.once('will-quit', () => app.exit(1));
    app.quit();
  });
}
