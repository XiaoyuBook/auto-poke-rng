const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { RuntimeClient } = require('../electron/runtime-client.cjs');
const { ScriptRunner, addSequenceApi } = require('../electron/script-runner.cjs');
const localPython = path.join(__dirname, '..', '.deps', 'script-python', 'Scripts', 'python.exe');
const pythonExecutable = process.env.AUTO_POKE_PYTHON || (fs.existsSync(localPython) ? localPython : 'python');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const neutral = { buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 };
async function connected(client, config = {}) {
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.off('event', listener); reject(new Error('Video never connected')); }, 5000);
    const listener = value => { if (value.event === 'video.state' && ['connected','failed'].includes(value.state.status)) { clearTimeout(timer); client.off('event', listener); value.state.status === 'connected' ? resolve(value.state) : reject(new Error(value.state.message)); } };
    client.on('event', listener);
  });
  const [, state] = await Promise.all([client.call('video.start', { deviceId: 'synthetic', backend: 'msmf', width: 320, height: 240, fps: 30, ...config }), ready]);
  return state;
}
const request = (state, route) => fetch(state.baseUrl + route, { headers: { Authorization: 'Bearer ' + state.token }, signal: AbortSignal.timeout(3000) });

test('one capture, independent readers, immutable snapshots, shared memory, reconnect and ownership', { timeout: 20000 }, async () => {
  const client = new RuntimeClient({ testMode: true });
  const rival = new RuntimeClient({ testMode: true });
  const controller = addSequenceApi(new RuntimeClient({ role: 'controller', testMode: true }));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poke-image-script-'));
  const events = [];
  const runner = new ScriptRunner({ controller, rootDirectory: root, getVideo: () => state, emit: event => events.push(event) });
  let state;
  try {
    state = await connected(client);
    assert.equal((await fetch(state.baseUrl + '/frame')).status, 401);
    const first = await request(state, '/frame'); const sequence = Number(first.headers.get('x-frame-sequence'));
    const frozen = Buffer.from(await first.arrayBuffer()); assert.equal(frozen.length, 320 * 240 * 3);
    const route = '/frame?mode=next&after=' + sequence;
    const responses = await Promise.all(Array.from({ length: 4 }, () => request(state, route)));
    assert.equal(new Set(responses.map(r => r.headers.get('x-frame-sequence'))).size, 1);
    const frames = await Promise.all(responses.map(async r => Buffer.from(await r.arrayBuffer())));
    for (const frame of frames) assert.deepEqual(frame, frames[0]);
    const previews = await Promise.all([fetch(state.previewUrl), fetch(state.previewUrl)]);
    for (const preview of previews) { assert.match(preview.headers.get('content-type'), /multipart/); const reader=preview.body.getReader(); assert.ok((await reader.read()).value.length); await reader.cancel(); }
    const snap = await request(state, '/snapshot.png'); const png = Buffer.from(await snap.arrayBuffer());
    assert.equal(png.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
    const python = spawnSync(pythonExecutable, ['-c', 'import sys,json; sys.path.insert(0,"runtime/clients"); from frames import Frames; d=json.loads(sys.argv[1]); a=Frames(d); b=Frames(d); x=a.read(next_frame=True); y=b.read(next_frame=True); assert x.bgr==y.bgr and x.sequence==y.sequence; assert len(x.bgr)==320*240*3; a.close(); b.close()', JSON.stringify(state.sharedMemory)], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    assert.equal(python.status, 0, python.stderr);
    // Existing .IL matcher consumes the very same native source as HTTP/preview.
    const fixture = spawnSync(pythonExecutable, ['-c', `
import base64, json, sys
from pathlib import Path
import cv2, numpy as np
frame = cv2.imdecode(np.frombuffer(sys.stdin.buffer.read(), dtype=np.uint8), cv2.IMREAD_COLOR)
template = frame[20:60, 20:100]
encoded = base64.b64encode(cv2.imencode('.png', template)[1]).decode('ascii')
target = Path(sys.argv[1]) / 'ImgLabel'
target.mkdir()
(target / '目标.IL').write_text(json.dumps(dict(searchMethod=5, ImgBase64=encoded,
    RangeX=0, RangeY=0, RangeWidth=320, RangeHeight=120,
    TargetX=20, TargetY=20, TargetWidth=80, TargetHeight=40)), encoding='utf-8')
`, root], { input: png, timeout: 5000, windowsHide: true });
    assert.equal(fixture.status, 0, fixture.stderr?.toString());
    const script = '$score = @目标\nPRINT $score\nA 35';
    fs.writeFileSync(path.join(root, 'image.rng'), script);
    await controller.call('controller.connect', { port: 'mock' });
    await runner.start({ text: script, path: 'image.rng' });
    await runner.current.done;
    const done = events.find(event => event.event === 'script.done');
    assert.equal(done?.status, 'completed', done?.message);
    assert.ok(events.some(event => event.event === 'script.log' && event.message.trim() === '100'));
    assert.equal((await controller.call('controller.status')).status, 'connected');
    assert.equal((await client.call('video.status')).session, state.session);
    events.length = 0;
    const dependent = '$score = @目标\nWAIT 60000';
    fs.writeFileSync(path.join(root, 'dependent.rng'), dependent);
    await runner.start({ text: dependent, path: 'dependent.rng' });
    while (!events.some(event => event.event === 'script.started' && event.requiresVideo)) await delay(20);
    const stopped = runner.current.done;
    runner.handleVideoState({ status: 'idle' });
    await stopped;
    const disconnected = events.find(event => event.event === 'script.done');
    assert.equal(disconnected.status, 'failed');
    assert.match(disconnected.message, /视频源已断开/);
    assert.deepEqual((await controller.call('controller.status')).report, neutral);

    events.length = 0;
    await runner.start({ text: dependent, path: 'dependent.rng' });
    while (!events.some(event => event.event === 'script.started' && event.requiresVideo)) await delay(20);
    const sessionChanged = runner.current.done;
    runner.handleVideoState({ status: 'connected', session: 'new-session' });
    await sessionChanged;
    const changed = events.find(event => event.event === 'script.done');
    assert.equal(changed.status, 'failed');
    assert.match(changed.message, /视频源会话已变化/);
    assert.deepEqual((await controller.call('controller.status')).report, neutral);

    await delay(400);
    const slow = await request(state, '/frame?mode=next&after=' + sequence);
    assert.ok(Number(slow.headers.get('x-frame-skipped')) > 0); await slow.arrayBuffer();
    await assert.rejects(connected(rival), /另一个/);
    assert.equal((await client.call('video.status')).session, state.session);
    await client.call('video.stop');
    assert.equal((await request(state, '/frame')).status, 503);
    const next = await connected(client); assert.notEqual(next.session, state.session);
    const stale = await request(next, '/frame?session=' + encodeURIComponent(state.session)); assert.equal(stale.status, 409);
    assert.equal(frozen.length, 320 * 240 * 3);
  } finally { await runner.stop(); await controller.close(); await rival.close(); await client.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('production mode cannot silently select synthetic hardware', async () => {
  const client = new RuntimeClient();
  try { await assert.rejects(client.call('video.start', { deviceId:'synthetic' }), /模拟设备/); }
  finally { await client.close(); }
});
