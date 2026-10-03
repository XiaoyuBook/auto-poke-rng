// Local-only pipeline: Python observation -> FRLG lifecycle -> real JPEG -> QQ HTTP fixture.
const { app, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { registerFrlgAutomation } = require('../electron/frlg-automation.cjs');
const { QQNotificationService } = require('../electron/qq-notifications.cjs');
const { QQClient } = require('../electron/qq-client.cjs');
const { pythonPath } = require('../electron/frlg-rng-client.cjs');
const { createQQFixture } = require('./helpers/qq-fixture.cjs');

const root = path.resolve(__dirname, '..');
let fixture, server, workflow, notifications;
const timer = setTimeout(() => { console.error('FRLG notification pipeline timed out'); app.exit(1); }, 15000);
async function until(action) {
  for (let i = 0; i < 200; ++i) { if (action()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw Error('notification pipeline did not settle');
}
async function close() {
  await workflow?.close(); notifications?.close(); await fixture?.close();
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  clearTimeout(timer);
}
app.whenReady().then(async () => {
  fixture = await createQQFixture();
  const bitmap = Buffer.alloc(64 * 48 * 4, 180);
  for (let i = 3; i < bitmap.length; i += 4) bitmap[i] = 255;
  const observedFrame = nativeImage.createFromBitmap(bitmap, { width: 64, height: 48 }).toPNG();
  const expectedJpeg = nativeImage.createFromBuffer(observedFrame).toJPEG(88);
  let frame = observedFrame, snapshots = 0, encodings = 0;
  server = http.createServer((request, response) => {
    assert.equal(request.url, '/snapshot.png?session=game-session');
    assert.equal(request.headers.authorization, 'Bearer local-frame-token');
    snapshots++; response.setHeader('Content-Type', 'image/png'); response.end(frame);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  notifications = new QQNotificationService({
    store: { load: () => ({ appId: 'TEST_APP', secret: 'TEST_SECRET', userOpenId: 'USER', attachImage: true }), save() {} },
    client: new QQClient(fixture.options),
  });
  const events = new EventEmitter(), records = [];
  let claimed = false, scriptId, serial = 0;
  const sender = { send() {}, isDestroyed: () => false };
  workflow = registerFrlgAutomation({ ipcMain: { handle() {} }, getMainWindow: () => ({ webContents: sender }),
    devices: { events, getState: () => ({ controller: { status: 'connected' }, video: { status: 'connected',
      baseUrl: `http://127.0.0.1:${server.address().port}`, session: 'game-session', token: 'local-frame-token' } }),
      claimAutomation: async () => { claimed = true; }, releaseAutomation: () => { claimed = false; },
      runner: { rootDirectory: path.join(os.tmpdir(), 'frlg-notification-fixture'), validate: async () => ({ valid: true }),
        start: async () => ({ runId: scriptId = 'script-' + ++serial }), stop: async () => events.emit('script', { event: 'script.done', runId: scriptId, status: 'cancelled' }) },
    }, client: { call: async () => ({ main: 'main.ecs', manifest: 'plan.json' }) }, userData: os.tmpdir(), notifications,
    readFile: async file => file === 'plan.json' ? '{}' : 'PRINT test', makeDirectory: async () => {},
    encodeNotificationImage: bytes => { encodings++; return nativeImage.createFromBuffer(bytes).toJPEG(88); },
  });
  const python = spawnSync(pythonPath(), ['-X', 'utf8', '-c',
    "import json; from frlg_round_records import RoundRecorder; r=RoundRecorder(lambda x:print(json.dumps(x))); r.consume('第 3 轮开始\\n已识别到闪光个体\\nPRECALIBRATION_UPDATE|V=1|SEED_INDEX=5|FRAME_PRE=41|EVIDENCE=TARGET_SHINY|TARGET_DEX=25|OBSERVED_DEX=25\\n')"],
    { env: { ...process.env, PYTHONPATH: path.join(root, 'runtime/python') }, encoding: 'utf8', windowsHide: true, timeout: 5000 });
  assert.equal(python.status, 0, python.stderr);
  records.push(...python.stdout.trim().split('\n').map(JSON.parse));
  assert.equal(records.at(-1).data.result, '目标出闪');
  const start = () => workflow.start({ request: { pokemon: 'Pikachu' }, profileId: 'test-save', options: { update_precalibration: false } });
  const observe = () => records.forEach(record => events.emit('script', { event: 'script.round', runId: scriptId, ...record }));
  const finish = () => events.emit('script', { event: 'script.done', runId: scriptId, status: 'completed' });
  notifications.operation = 'verify'; // Keep the queue occupied while the game and task finish.
  await start(); observe(); await until(() => encodings === 1);
  frame = Buffer.from('later task screen'); finish(); await workflow.settled();
  await until(() => notifications.notificationQueue.length === 1);
  assert.equal(claimed, false); assert.equal(fixture.requests.length, 0);
  notifications.operation = ''; notifications.drainNotifications();
  await until(() => notifications.records.some(record => record.success) && !notifications.notificationActive);
  const messages = fixture.requests.filter(request => request.path === '/v2/users/USER/messages');
  assert.deepEqual(messages.map(request => request.body.msg_type), [0, 7]);
  assert.match(messages[0].body.content, /火叶自动乱数 · 目标出闪\n结果：目标出闪/);
  assert.match(messages[0].body.content, /第 3 轮目标出闪.*25/);
  const uploaded = Buffer.concat(fixture.requests.filter(request => request.method === 'PUT').map(request => request.body));
  assert.deepEqual(uploaded, expectedJpeg);
  assert.deepEqual(nativeImage.createFromBuffer(uploaded).getSize(), { width: 64, height: 48 });
  assert.equal(snapshots, 1); assert.equal(encodings, 1);
  notifications.update({ attachImage: false });
  await start(); observe(); finish(); await workflow.settled();
  await until(() => fixture.requests.filter(request => request.path === '/v2/users/USER/messages').length === 3);
  assert.equal(snapshots, 1, 'disabled task image never fetches a frame');
  assert.equal(fixture.requests.filter(request => request.path.endsWith('/messages') && request.body.msg_type === 7).length, 1);
  await close();
  console.log('PASS: Python confirmed observation -> cached authorized game frame -> native JPEG -> queued QQ text and image; image switch honored.');
  app.exit(0);
}).catch(async error => { console.error(error); await close().catch(() => {}); app.exit(1); });
