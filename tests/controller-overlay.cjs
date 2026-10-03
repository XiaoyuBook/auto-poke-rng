// Real C++ mock reports -> IPC -> the actual transparent Electron overlay -> pixels.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerDevices } = require('../electron/devices.cjs');

const root = path.resolve(__dirname, '..');
const dpi = process.env.AUTO_POKE_TEST_DPI;
const output = path.join(process.env.AUTO_POKE_OVERLAY_OUTPUT || path.join(root, 'node_modules/.tmp/controller-overlay-review'), dpi ? 'dpi-' + dpi : '');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
if (dpi) app.commandLine.appendSwitch('force-device-scale-factor', dpi);
let devices;
const rendererErrors = [];
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', details => {
    if (details.level === 'error') rendererErrors.push(details.message);
  });
});
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
  let overlay = BrowserWindow.getAllWindows().find(window => window !== bridge);
  const reopen = async (toggle = false) => {
    await command(toggle ? 'window.desktop.overlay.toggle()' : 'window.desktop.overlay.show()');
    overlay = BrowserWindow.getAllWindows().find(window => window !== bridge);
    await until(() => js(overlay, 'Boolean(document.querySelector(".joycon-graphic"))'), 'reopened renderer loaded');
    // React installs subscriptions after the first paint. Wait for startup
    // effects and their IPC replies before retiring this widget again.
    await js(overlay, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await js(overlay, 'Promise.all([window.desktop.devices.getState(), window.desktop.overlay.getState()])');
  };
  await until(() => js(overlay, 'Boolean(document.querySelector(".joycon-graphic"))'), 'SVG overlay loaded');
  assert.match(overlay.webContents.getURL(), /window=controller-overlay/);
  assert.equal(await js(overlay, 'document.title'), 'Auto Poke RNG');
  assert.equal(await js(overlay, 'Boolean(document.querySelector("vite-error-overlay"))'), false);
  assert.equal(await js(overlay, 'Boolean(document.querySelector(".controller-overlay-close"))'), false);
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
    // The SVG uses xMidYMid meet: its 100-unit square follows the smaller
    // viewport dimension when fractional DPI rounds one edge differently.
    const graphicSize = Math.min(g.svg.width, g.svg.height);
    for (const stick of g.sticks) {
      assert.ok(Math.abs(stick.knob.x - stick.ring.x) < .01, 'neutral stick centers share X');
      assert.ok(Math.abs(stick.knob.y - stick.ring.y) < .01, 'neutral stick centers share Y');
      assert.ok(Math.abs(stick.knob.width / graphicSize - .15) < .001, 'knob is 15/100 units');
    }
    assert.ok(Math.abs(g.face.width / graphicSize - .09) < .001, 'face keys are 9/100 units');
    assert.ok(Math.abs(g.hat.width / graphicSize - .06) < .001, 'D-pad keys are 6/100 units');
    for (let i = 1; i < 4; i++) assert.ok(Math.abs((g.lights[i].y - g.lights[i - 1].y) / graphicSize - .1) < .001, 'light spacing is 10/100 units');
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

  // Exercise captured keyboard input while the hardware queue is held up.
  // This uses the real input manager/IPC/renderer but never installs an OS hook.
  const input = devices.controllerOverlay.input;
  input.setMapping({ LSUp: 'KeyW', LSDown: 'KeyS', LSLeft: 'KeyA', LSRight: 'KeyD', A: 'KeyL' });
  let resumeSerial;
  input.pending = new Promise(resolve => { resumeSerial = resolve; });
  try {
    for (const [vk, x, y] of [[87, 128, 0], [65, 0, 128], [83, 128, 255], [68, 255, 128]]) {
      input.handleKey({ vk, down: true });
      await until(() => js(overlay, 'document.querySelector("[data-stick=left]").dataset.moved === "true"'), 'WASD moves the stick before serial completion');
      const g = await geometry();
      const direction = delta => Math.abs(delta) < .01 ? 0 : Math.sign(delta);
      assert.equal(direction(g.sticks[0].knob.x - g.sticks[0].ring.x), Math.sign(x - 128));
      assert.equal(direction(g.sticks[0].knob.y - g.sticks[0].ring.y), Math.sign(y - 128));
      input.handleKey({ vk, down: false });
      await checkNeutral();
    }
    for (const vk of [87, 65, 76]) input.handleKey({ vk, down: true });
    await until(() => js(overlay, 'document.querySelector("[data-control=A]").dataset.pressed === "true"'), 'mapped button lights up immediately');
    assert.equal((await geometry()).moved, 1);
    assert.ok((await snapshot('keyboard-wasd-and-a')).green > 20);
    // A late hardware report cannot overwrite more recent local input.
    await command('window.desktop.devices.controller.reset()');
    assert.equal(await js(overlay, 'document.querySelector("[data-control=A]").dataset.pressed'), 'true');
    // Reopening/reloading the renderer gets held inputs from the state snapshot.
    await overlay.webContents.reload();
    await until(() => js(overlay, 'document.querySelector("[data-control=A]")?.dataset.pressed === "true"'), 'held keyboard snapshot survives renderer reload');
    for (const vk of [87, 65, 76]) input.handleKey({ vk, down: false });
    await checkNeutral();
  } finally {
    resumeSerial();
    await input.pending;
  }

  await input.setActive(false);
  await until(() => js(overlay, 'Boolean(document.querySelector(".controller-overlay.standby"))'), 'standby presentation');
  await checkNeutral();
  assert.equal((await snapshot('standby')).green, 0);

  // A script takes over after manual input: its reports and running lights
  // must replace the local keyboard snapshot, with no stale A/W highlight.
  input.setState({ active: true, mode: 'active' });
  input.handleKey({ vk: 87, down: true });
  input.handleKey({ vk: 76, down: true });
  await input.pending;
  const { owner } = await input.controller.call('controller.acquire');
  await input.controller.call('controller.key', { owner, key: 'B', down: true });
  await until(() => js(overlay, 'document.querySelector("[data-control=B]").dataset.pressed === "true"'), 'script-owned button state');
  assert.equal(await js(overlay, 'document.querySelector("[data-control=A]").dataset.pressed'), 'false');
  assert.equal((await geometry()).moved, 0);
  assert.equal(await js(overlay, 'document.querySelector(".joycon-lights").dataset.running'), 'true');
  await input.controller.call('controller.release', { owner });
  await checkNeutral();

  const configuredSize = Math.round(100 * (await command('window.desktop.overlay.getState()')).scale);
  for (let sample = 0; sample < 300; sample++) {
    await command(`window.desktop.overlay.moveDrag(${sample % 100}, ${sample % 80}, 'size-drag')`);
    const bounds = overlay.getContentBounds();
    assert.deepEqual([bounds.width, bounds.height], [configuredSize, configuredSize], 'drag preserves configured size at sample ' + sample);
  }

  // Deliver real Chromium mouse events to exercise capture, renderer handlers,
  // preload and native movement together; keep the cursor's screen point fixed
  // after the window moves by adjusting the final local coordinate.
  for (const button of ['left', 'right']) {
    overlay.setPosition(200, 200);
    overlay.webContents.sendInputEvent({ type: 'mouseDown', button, x: 50, y: 50, globalX: 250, globalY: 250 });
    overlay.webContents.sendInputEvent({ type: 'mouseMove', x: 74, y: 66, globalX: 274, globalY: 266, modifiers: [button + 'ButtonDown'] });
    await until(() => overlay.getPosition()[0] === 224 && overlay.getPosition()[1] === 216, button + ' drag moves native window');
    overlay.webContents.sendInputEvent({ type: 'mouseUp', button, x: 50, y: 50, globalX: 274, globalY: 266 });
    await delay(40);
    assert.deepEqual(overlay.getPosition(), [224, 216], button + ' release preserves final position');
    assert.equal(input.getState().active, false, 'drag does not toggle keyboard capture');
  }

  // Total displacement stays anchored, including repeated samples and DPI.
  const origin = overlay.getPosition();
  for (const delta of [10, 20, 20, 35]) await command(`window.desktop.overlay.moveDrag(${delta}, 12, 'drag-test')`);
  assert.deepEqual(overlay.getPosition(), [origin[0] + 35, origin[1] + 12]);
  await command('window.desktop.overlay.moveDrag(-10, -12, "next-drag")');
  assert.deepEqual(overlay.getPosition(), [origin[0] + 25, origin[1]]);

  // Ctrl+Escape travels directly through the input manager, not the hide IPC.
  // The real native window must disappear even while serial cleanup is stuck.
  let finishReset;
  input.pending = new Promise(resolve => { finishReset = resolve; });
  try {
    input.handleKey({ vk: 0x1b, down: true, control: true });
    assert.equal(input.getState().visible, false);
    assert.equal(overlay.isDestroyed(), true, 'Ctrl+Escape discards the native window immediately');
  } finally { finishReset(); await input.pending; }

  // An old hide completion must not hide a subsequent show.
  await reopen();
  let finishHide;
  input.pending = new Promise(resolve => { finishHide = resolve; });
  const oldWindow = overlay;
  const previousPosition = overlay.getPosition();
  const hiding = devices.controllerOverlay.hide();
  assert.equal(oldWindow.isDestroyed(), true, 'hide IPC retires the widget before serial reset');
  await reopen();
  assert.notEqual(overlay, oldWindow, 'reopen creates a fresh native widget');
  assert.deepEqual(overlay.getPosition(), previousPosition, 'reopen restores position');
  finishHide(); await hiding;
  assert.equal(overlay.isVisible(), true, 'new show survives old hide completion');
  assert.equal(devices.controllerOverlay.getState().visible, true);

  // Keep OS keyboard capture out of this native-window test; its lifecycle
  // has separate tests. Use the toolbar's actual toggle IPC after each close.
  input.ensureChild = async () => {};
  for (let cycle = 1; cycle <= 10; cycle++) {
    if (cycle > 1) await reopen(true);
    assert.equal(overlay.getContentBounds().width, 160, 'reopen preserves configured size');
    assert.equal(overlay.getContentBounds().height, 160, 'reopen preserves configured height');
    const activeBeforeDrag = input.getState().active;
    // Drag after every reopen, rather than checking only the first widget.
    const start = overlay.getPosition();
    const button = cycle % 2 ? 'right' : 'left';
    overlay.webContents.sendInputEvent({ type: 'mouseDown', button, x: 50, y: 50, globalX: start[0] + 50, globalY: start[1] + 50 });
    overlay.webContents.sendInputEvent({ type: 'mouseMove', x: 62, y: 58, globalX: start[0] + 62, globalY: start[1] + 58, modifiers: [button + 'ButtonDown'] });
    await until(() => overlay.getPosition()[0] === start[0] + 12 && overlay.getPosition()[1] === start[1] + 8, 'reopened drag on cycle ' + cycle);
    overlay.webContents.sendInputEvent({ type: 'mouseUp', button, x: 50, y: 50, globalX: start[0] + 62, globalY: start[1] + 58 });
    await delay(30);
    assert.equal(overlay.getContentBounds().width, 160, 'drag does not grow widget on cycle ' + cycle);
    assert.equal(input.getState().active, activeBeforeDrag, 'drag does not toggle activation on cycle ' + cycle);
    overlay.webContents.sendInputEvent({ type: 'mouseDown', button: 'middle', x: 50, y: 50 });
    await delay(40);
    assert.equal(overlay.isVisible(), true, 'middle down keeps widget alive for physical release');
    overlay.webContents.sendInputEvent({ type: 'mouseUp', button: 'middle', x: 50, y: 50 });
    await until(() => overlay.isDestroyed(), 'middle release closes native overlay on cycle ' + cycle);
  }

  await reopen();
  overlay.emit('unresponsive');
  assert.equal(overlay.isDestroyed(), true, 'unresponsive overlay stops input and retires its widget');
  await input.pending;
  await reopen();
  overlay.webContents.forcefullyCrashRenderer();
  await until(() => overlay.isDestroyed(), 'crashed renderer window is discarded');
  await command('window.desktop.overlay.show()');
  const replacement = BrowserWindow.getAllWindows().find(window => window !== bridge);
  assert.notEqual(replacement, overlay, 'show creates a fresh overlay after a renderer crash');
  await until(() => js(replacement, 'Boolean(document.querySelector(".joycon-graphic"))'), 'replacement renderer loads');
  await js(replacement, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await js(replacement, 'Promise.all([window.desktop.devices.getState(), window.desktop.overlay.getState()])');

  await command('window.desktop.devices.controller.disconnect()');
  await until(async () => !(await command('window.desktop.overlay.getState()')).visible, 'disconnect hides overlay');
  assert.deepEqual(rendererErrors, [], 'renderers have no console errors');
  await devices.close();
  clearTimeout(timeout);
  console.log('PASS: overlay pixels at 80/100/120/160; 300 moves without growth; 10 reopen/drag/middle-release cycles; Ctrl+Escape, immediate close during serial delay, reopen race, keyboard feedback and renderer crash recovery.');
  app.exit(0);
}).catch(async error => { console.error(error); if (devices) await devices.close(); clearTimeout(timeout); app.exit(1); });
