// Real C++ mock reports -> IPC -> the actual transparent Electron overlay -> pixels.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerDevices } = require('../electron/devices.cjs');

const root = path.resolve(__dirname, '..');
const dpi = process.env.AUTO_POKE_TEST_DPI;
const output = path.join(root, 'node_modules/.tmp/controller-overlay-review', dpi ? 'dpi-' + dpi : '');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
if (dpi) app.commandLine.appendSwitch('force-device-scale-factor', dpi);
let devices;
const timeout = setTimeout(() => { console.error('Overlay rendering test timed out'); app.exit(1); }, 45000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(action, message) {
  for (let i = 0; i < 100; i++) { if (await action()) return; await delay(30); }
  throw new Error(message);
}
const js = (window, code) => window.webContents.executeJavaScript(code, true);

app.whenReady().then(async () => {
  // A blank bridge window needs no script library or other UI services.
  const bridge = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
  } });
  await bridge.loadURL('about:blank');
  devices = registerDevices({ ipcMain, getWindows: () => BrowserWindow.getAllWindows(), testMode: true });
  const command = code => js(bridge, code);
  await command('window.desktop.devices.controller.connect("mock")');
  // Visual mode is a fixture; this test never installs a global keyboard hook.
  await command('window.desktop.overlay.setScale(1.6)');
  await command('window.desktop.overlay.show()');
  const overlay = BrowserWindow.getAllWindows().find(window => window !== bridge);
  await until(() => js(overlay, 'Boolean(document.querySelector(".joycon-graphic"))'), 'SVG overlay loaded');
  assert.equal(overlay.getContentBounds().width, 160, 'saved size applies on first open');
  devices.controllerOverlay.input.setState({ active: true, mode: 'active' });
  await until(() => js(overlay, 'Boolean(document.querySelector(".controller-overlay.active"))'), 'active presentation');
  await js(overlay, `Promise.all([...document.querySelectorAll('svg image')].map(node => {
    const image = new Image(); image.src = node.getAttribute('href'); return image.decode();
  }))`);

  const geometry = () => js(overlay, `(() => {
    const box = node => { const b = node.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, width: b.width, height: b.height }; };
    const svg = box(document.querySelector('svg'));
    const sticks = [...document.querySelectorAll('[data-stick]')].map(node => ({
      ring: box(node.querySelector('[data-part="ring"]')), knob: box(node.querySelector('[data-part="knob"]')),
    }));
    return { svg, sticks, pressed: [...document.querySelectorAll('[data-pressed="true"]')].length,
      moved: [...document.querySelectorAll('[data-moved="true"]')].length,
      face: box(document.querySelector('[data-control="A"]')),
      hat: box(document.querySelector('[data-control="hat-up"]')),
      lights: [...document.querySelectorAll('.joycon-light')].map(box) };
  })()`);
  const checkNeutral = async () => {
    await until(() => js(overlay, '!document.querySelector("[data-pressed=true], [data-moved=true]")'), 'no stuck highlights');
    const g = await geometry();
    for (const stick of g.sticks) {
      assert.ok(Math.abs(stick.knob.x - stick.ring.x) < .01, 'neutral stick centers share X');
      assert.ok(Math.abs(stick.knob.y - stick.ring.y) < .01, 'neutral stick centers share Y');
      assert.ok(Math.abs(stick.knob.width / g.svg.width - .15) < .001, 'knob is 15/100 units');
    }
    assert.ok(Math.abs(g.face.width / g.svg.width - .09) < .001, 'face keys are 9/100 units');
    assert.ok(Math.abs(g.hat.width / g.svg.width - .06) < .001, 'D-pad keys are 6/100 units');
    for (let i = 1; i < 4; i++) assert.ok(Math.abs((g.lights[i].y - g.lights[i - 1].y) / g.svg.height - .1) < .001, 'light spacing is 10/100 units');
  };
  const snapshot = async name => {
    await js(overlay, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const capture = await overlay.webContents.capturePage(undefined, { stayAwake: true });
    assert.equal(capture.isEmpty(), false);
    fs.writeFileSync(path.join(output, name + '.png'), capture.toPNG());
    // Electron uses BGRA bitmaps on Windows. Detect green state pixels, regardless of DPI.
    const bytes = capture.toBitmap(); let green = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      if (bytes[i + 3] > 100 && bytes[i + 1] > bytes[i + 2] + 40 && bytes[i + 1] > bytes[i] + 20) green++;
    }
    return { green, image: capture };
  };

  // Check actual rendered neutral pixels and geometric centers at every offered size.
  for (const scale of [.8, 1, 1.2, 1.6]) {
    await command(`window.desktop.overlay.setScale(${scale})`);
    await until(() => js(overlay, `innerWidth === ${100 * scale}`), 'resized overlay');
    assert.equal((await command('window.desktop.overlay.getState()')).scale, scale, 'size state survives mode changes');
    await checkNeutral();
    assert.equal((await snapshot(`neutral-${100 * scale}`)).green, 0, 'neutral image has no green controls');
  }
  await command('window.desktop.devices.controller.stick("LS", 0, 0)');
  await command('window.desktop.devices.controller.stick("RS", 255, 255)');
  await until(() => js(overlay, 'document.querySelectorAll("[data-moved=true]").length === 2'), 'stick displacement rendered');
  const moved = await geometry();
  assert.ok(moved.sticks[0].knob.x < moved.sticks[0].ring.x && moved.sticks[0].knob.y < moved.sticks[0].ring.y);
  assert.ok(moved.sticks[1].knob.x > moved.sticks[1].ring.x && moved.sticks[1].knob.y > moved.sticks[1].ring.y);
  assert.equal(moved.pressed, 0, 'moving a stick does not click it');
  assert.ok((await snapshot('moving')).green > 20, 'moving highlights are visible');

  await command('window.desktop.devices.controller.reset()');
  for (const key of ['LCLICK', 'RCLICK', 'A', 'ZL']) await command(`window.desktop.devices.controller.key('${key}', true)`);
  await until(() => js(overlay, 'document.querySelectorAll("[data-pressed=true]").length === 4'), 'independent pressed controls');
  assert.equal((await geometry()).moved, 0, 'clicking sticks does not move them');
  assert.ok((await snapshot('pressed')).green > 20);
  await command('window.desktop.devices.controller.reset()');

  const hats = [['UP', ['up']], ['UP_RIGHT', ['up', 'right']], ['RIGHT', ['right']], ['DOWN_RIGHT', ['down', 'right']],
    ['DOWN', ['down']], ['DOWN_LEFT', ['down', 'left']], ['LEFT', ['left']], ['UP_LEFT', ['up', 'left']]];
  for (const [key, directions] of hats) {
    await command(`window.desktop.devices.controller.key('${key}', true)`);
    await until(() => js(overlay, `document.querySelectorAll('[data-control^="hat-"][data-pressed="true"]').length === ${directions.length}`), key);
    const displayed = await js(overlay, `[...document.querySelectorAll('[data-control^="hat-"][data-pressed="true"]')].map(node => node.dataset.control.slice(4))`);
    assert.deepEqual(displayed.sort(), [...directions].sort(), `hat ${key} matches firmware ordinal`);
    const capture = await snapshot('hat-' + key.toLowerCase());
    assert.ok(capture.green > 5, 'D-pad directions are visible');
    await command(`window.desktop.devices.controller.key('${key}', false)`);
    await checkNeutral();
  }
  const released = await snapshot('released');
  assert.equal(released.green, 0);
  assert.ok(released.image.toPNG().equals(fs.readFileSync(path.join(output, 'neutral-160.png'))), 'release reproduces the original neutral pixels');

  devices.controllerOverlay.input.setState({ active: false, mode: 'standby' });
  await until(() => js(overlay, 'Boolean(document.querySelector(".controller-overlay.standby"))'), 'standby presentation');
  await checkNeutral();
  assert.equal((await snapshot('standby')).green, 0);
  await command('window.desktop.devices.controller.disconnect()');
  await until(async () => !(await command('window.desktop.overlay.getState()')).visible, 'disconnect hides overlay');
  await devices.close();
  clearTimeout(timeout);
  console.log('PASS: actual overlay pixels and geometry at 80/100/120/160; neutral, movement, clicks, eight hat directions, release and standby.');
  app.exit(0);
}).catch(async error => { console.error(error); if (devices) await devices.close(); clearTimeout(timeout); app.exit(1); });
