const http = require('node:http');
const { WebSocketServer } = require('ws');

async function createQQFixture() {
  const state = { requests: [], peers: [], packets: [], errors: {}, ready: true, hold: '', heartbeat: true };
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const body = request.method === 'PUT' ? raw : raw.length ? JSON.parse(raw.toString()) : null;
    state.requests.push({ path: request.url, method: request.method, headers: request.headers, body });
    if (request.url === state.hold) return;
    let result = {};
    if (request.url === '/token') result = { access_token: 'TEST_TOKEN', expires_in: '7200' };
    else if (request.url === '/gateway') result = { url: state.base.replace('http:', 'ws:') };
    else if (request.url.endsWith('/upload_prepare')) {
      const size = 4096;
      result = { upload_id: 'UPLOAD', block_size: String(size), parts: Array.from({ length: Math.ceil(Number(body.file_size) / size) }, (_, i) => ({ index: i + 1, presigned_url: state.base + '/upload/' + (i + 1) })) };
    } else if (request.url.endsWith('/files')) result = { file_info: 'MEDIA_INFO' };
    else if (request.url.endsWith('/messages')) result = { id: 'MESSAGE_ID' };
    const failure = state.errors[request.url];
    response.writeHead(failure?.status || 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(failure?.body || result));
  });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', peer => {
    state.peers.push(peer);
    peer.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 100 } }));
    peer.on('message', raw => {
      const packet = JSON.parse(raw.toString()); state.packets.push(packet);
      if (packet.op === 2 && state.ready) peer.send(JSON.stringify({ op: 0, t: 'READY', s: 12, d: {} }));
      if (packet.op === 1 && state.heartbeat) peer.send(JSON.stringify({ op: 11 }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  state.base = 'http://127.0.0.1:' + server.address().port;
  state.options = { apiBase: state.base, tokenUrl: state.base + '/token', allowInsecure: true, requestTimeout: 1500 };
  state.packet = packet => state.peers.at(-1).send(JSON.stringify(packet));
  state.bind = (kind, code, openId = kind === 'user' ? 'USER_OPEN_ID' : 'GROUP_OPEN_ID') => state.packet({
    op: 0, t: kind === 'user' ? 'C2C_MESSAGE_CREATE' : 'GROUP_AT_MESSAGE_CREATE',
    d: { content: code, author: { user_openid: openId }, group_openid: openId },
  });
  state.close = async () => {
    for (const peer of sockets.clients) peer.terminate();
    await new Promise(resolve => sockets.close(resolve));
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  };
  return state;
}
module.exports = { createQQFixture };
