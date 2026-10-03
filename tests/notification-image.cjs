const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { captureTaskImage } = require('../electron/notification-image.cjs');

async function fixture(t, respond = (_request, response) => response.end('game-frame')) {
  const requests = [];
  const server = http.createServer((request, response) => { requests.push(request); respond(request, response); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const source = { status: 'connected', baseUrl: `http://127.0.0.1:${server.address().port}`, session: 'session-one', token: 'local-test-token' };
  const logs = [];
  const capture = overrides => captureTaskImage({ notifications: { wantsTaskImage: () => true }, outcome: 'completed', getVideo: () => source,
    onError: message => logs.push(message), ...overrides });
  return { source, capture, logs, requests };
}

test('task images use the authorized shared game frame and the JPEG encoder', async t => {
  const f = await fixture(t);
  const bytes = await f.capture({ encodeImage: image => Buffer.concat([Buffer.from('jpeg:'), image]) });
  assert.deepEqual(bytes, Buffer.from('jpeg:game-frame'));
  assert.equal(f.requests[0].url, '/snapshot.png?session=session-one');
  assert.equal(f.requests[0].headers.authorization, 'Bearer local-test-token');
  assert.deepEqual(f.logs, []);
});

test('a switched video session cannot supply an unrelated picture to a completed task', async t => {
  let changeSession;
  const f = await fixture(t, (_request, response) => { changeSession(); response.end('old-frame'); });
  changeSession = () => { f.source.session = 'session-two'; };
  assert.equal(await f.capture(), undefined);
  assert.match(f.logs[0], /视频源已断开或切换/);
});

test('image policy, disconnected source, HTTP failures and invalid encodings preserve text fallback', async t => {
  const f = await fixture(t, (_request, response) => { response.writeHead(503); response.end(); });
  assert.equal(await f.capture({ notifications: { wantsTaskImage: () => false } }), undefined);
  assert.equal(f.requests.length, 0);
  f.source.status = 'failed';
  assert.equal(await f.capture(), undefined); assert.equal(f.requests.length, 0);
  f.source.status = 'connected';
  assert.equal(await f.capture(), undefined); assert.match(f.logs.at(-1), /HTTP 503/);
  assert.equal(await f.capture({ captureImage: () => Buffer.from('frame'), encodeImage: () => Buffer.alloc(0) }), undefined);
  assert.match(f.logs.at(-1), /编码结果为空/);
  assert.equal(await f.capture({ captureImage: () => Buffer.alloc(10 * 1024 * 1024 + 1) }), undefined);
  assert.match(f.logs.at(-1), /超过 10 MB/);
});
