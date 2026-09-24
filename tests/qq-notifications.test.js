import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { QQClient } = require('../electron/qq-client.cjs');
const { QQSettingsStore, QQNotificationService, registerQQNotifications } = require('../electron/qq-notifications.cjs');
const { createQQFixture } = require('./helpers/qq-fixture.cjs');

let fixture, client, cancellation;
beforeEach(async () => {
  fixture = await createQQFixture();
  client = new QQClient(fixture.options); client.configure('TEST_APP', 'TEST_SECRET');
  cancellation = new AbortController();
});
afterEach(async () => { cancellation.abort(); await fixture.close(); });
const user = { kind: 'user', openId: 'USER' }, group = { kind: 'group', openId: 'GROUP' };

describe('QQ HTTP and WebSocket protocol', () => {
  it('submits text and multipart images to both recipients, caches tokens and never sends bearer tokens to uploads', async () => {
    const image = Buffer.alloc(9000, 65);
    const results = await client.send([user, group], '中文通知', image);
    expect(results.every(result => result.success)).toBe(true);
    const messages = fixture.requests.filter(request => request.path.endsWith('/messages'));
    expect(messages.map(request => [request.path, request.body.msg_type])).toEqual([
      ['/v2/users/USER/messages', 0], ['/v2/users/USER/messages', 7], ['/v2/groups/GROUP/messages', 0], ['/v2/groups/GROUP/messages', 7],
    ]);
    expect(messages[0].body.content).toBe('中文通知');
    expect(messages[1].body.media.file_info).toBe('MEDIA_INFO');
    expect(fixture.requests.filter(request => request.path === '/token')).toHaveLength(1);
    const uploads = fixture.requests.filter(request => request.method === 'PUT');
    expect(uploads).toHaveLength(6);
    expect(uploads.every(request => !request.headers.authorization)).toBe(true);
    expect(Buffer.concat(uploads.slice(0, 3).map(request => request.body))).toEqual(image);
    client.configure('SECOND_APP', 'SECOND_SECRET');
    await client.verify();
    expect(fixture.requests.filter(request => request.path === '/token')).toHaveLength(2);
  });

  it('records partial delivery, continues the other recipient and does not retry rejected media', async () => {
    fixture.errors['/v2/users/USER/upload_prepare'] = { status: 500, body: { detail: 'TEST_SECRET TEST_TOKEN' } };
    const results = await client.send([user, group], '测试', Buffer.from('image'));
    expect(results[0]).toMatchObject({ success: false, text: 'submitted', image: 'failed' });
    expect(results[0].detail).not.toMatch(/TEST_SECRET|TEST_TOKEN/);
    expect(results[1].success).toBe(true);
    expect(fixture.requests.filter(request => request.path === '/v2/users/USER/upload_prepare')).toHaveLength(1);
  });

  it('redacts an expired token before invalidating it and refreshes on the next explicit send', async () => {
    fixture.errors['/v2/users/USER/messages'] = { status: 401, body: { detail: 'TEST_TOKEN TEST_SECRET' } };
    const [failed] = await client.send([user], '测试');
    expect(failed.detail).not.toMatch(/TEST_TOKEN|TEST_SECRET/);
    delete fixture.errors['/v2/users/USER/messages'];
    expect((await client.send([user], '重试'))[0].success).toBe(true);
    expect(fixture.requests.filter(request => request.path === '/token')).toHaveLength(2);
  });

  it.each(['user', 'group'])('binds %s only with the current code and matching event type; stale codes and unrelated additions do not bind', async kind => {
    client.bindingLifetime = 230;
    const bindings = [];
    const promise = client.bind(kind, { signal: cancellation.signal, onBinding: value => { if (value) bindings.push(value); } });
    await vi.waitFor(() => expect(bindings.length).toBeGreaterThan(0));
    const old = bindings[0].code;
    fixture.packet({ op: 0, t: 'FRIEND_ADD', d: { openid: 'WRONG' } });
    await vi.waitFor(() => expect(bindings.at(-1).generation).toBeGreaterThan(1));
    const current = bindings.at(-1).code;
    fixture.bind(kind, old, 'EXPIRED');
    fixture.bind(kind === 'user' ? 'group' : 'user', current, 'WRONG_TYPE');
    fixture.bind(kind, '1' + current + '2', 'SUBSTRING');
    fixture.bind(kind, current, 'CORRECT');
    expect(await promise).toBe('CORRECT');
    expect(fixture.packets.find(packet => packet.op === 2).d.intents).toBe(1 << 25);
    expect(fixture.packets.some(packet => packet.op === 1 && packet.d === 12)).toBe(true);
    await vi.waitFor(() => expect(fixture.peers.at(-1).readyState).toBe(3));
  });

  it('does not issue a code before READY and times out an unready gateway', async () => {
    fixture.ready = false; client.requestTimeout = 120;
    const binding = vi.fn();
    await expect(client.bind('user', { onBinding: binding })).rejects.toThrow('超时');
    expect(binding.mock.calls.filter(([value]) => value)).toHaveLength(0);
  });

  it('cancels a binding and permits a fresh operation without stale callbacks', async () => {
    let code;
    const promise = client.bind('user', { signal: cancellation.signal, onBinding: value => { if (value) code = value.code; } });
    const rejected = expect(promise).rejects.toThrow('取消');
    await vi.waitFor(() => expect(code).toBeTruthy());
    cancellation.abort(); await rejected;
    expect((await client.send([user], '新的操作'))[0].success).toBe(true);
  });

  it('cancels an in-flight HTTP submission without advancing to image uploads or retrying it', async () => {
    fixture.hold = '/v2/users/USER/messages';
    const promise = client.send([user], '测试', Buffer.from('image'), { signal: cancellation.signal });
    await vi.waitFor(() => expect(fixture.requests.some(request => request.path === fixture.hold)).toBe(true));
    cancellation.abort();
    expect((await promise)[0]).toMatchObject({ success: false, text: 'failed', image: 'skipped' });
    expect(fixture.requests.filter(request => request.path === fixture.hold)).toHaveLength(1);
    expect(fixture.requests.some(request => request.path.endsWith('/upload_prepare'))).toBe(false);
  });
});

function memoryStore() {
  return { fail: false, saved: null, load: () => ({ appId: '', secret: '', rememberSecret: false, userOpenId: '', groupOpenId: '', userEnabled: true, groupEnabled: false }),
    save(value) { if (this.fail) throw new Error('模拟磁盘写入失败'); this.saved = { ...value }; } };
}
function serviceFixture() {
  const store = memoryStore();
  const service = new QQNotificationService({ store, client, makeTestImage: () => Buffer.from('image') });
  service.update({ appId: 'TEST_APP', secret: 'TEST_SECRET' });
  return { service, store };
}

describe('QQ settings and standalone service', () => {
  it('keeps secrets out of plaintext files and snapshots, and round-trips protected storage', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-poke-qq-'));
    const file = path.join(folder, 'qq.json');
    const protection = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text).map(byte => byte ^ 73), decryptString: bytes => bytes.map(byte => byte ^ 73).toString() };
    try {
      const store = new QQSettingsStore(file, protection);
      const service = new QQNotificationService({ store, client });
      service.update({ appId: 'TEST_APP', secret: 'TEST_SECRET' });
      expect(fs.readFileSync(file, 'utf8')).not.toContain('TEST_SECRET');
      expect(store.load().secret).toBe('');
      expect(JSON.stringify(service.snapshot())).not.toContain('TEST_SECRET');
      service.update({ rememberSecret: true });
      expect(store.load().secret).toBe('TEST_SECRET');
      expect(fs.readFileSync(file, 'utf8')).not.toContain('TEST_SECRET');
      protection.decryptString = () => { throw new Error('Different Windows user'); };
      expect(store.load().secret).toBe('');
      expect(store.warning).toContain('解密');
      service.update({ rememberSecret: false });
      expect(fs.readFileSync(file, 'utf8')).not.toContain('protectedSecret');
    } finally { fs.rmSync(folder, { recursive: true, force: true }); }
  });

  it('keeps the old configuration when storage fails and clears recipients when AppID changes', () => {
    const { service, store } = serviceFixture();
    service.settings.userOpenId = 'ORIGINAL'; service.verified = true;
    store.fail = true;
    expect(() => service.update({ appId: 'OTHER' })).toThrow('磁盘');
    expect(service.snapshot()).toMatchObject({ hasSecret: true, verified: true, settings: { appId: 'TEST_APP', userOpenId: 'ORIGINAL' } });
    store.fail = false; service.update({ appId: 'OTHER' });
    expect(service.snapshot()).toMatchObject({ hasSecret: false, verified: false, settings: { userOpenId: '', groupOpenId: '' } });
  });

  it('does not report binding success when saving its result fails', async () => {
    const { service, store } = serviceFixture();
    await service.verify(); service.settings.userOpenId = 'ORIGINAL'; store.fail = true;
    const operation = service.bind('user');
    await vi.waitFor(() => expect(service.binding?.code).toBeTruthy());
    expect(service.snapshot().feedback).toContain('正在等待私聊');
    fixture.bind('user', service.binding.code, 'NEW');
    const result = await operation;
    expect(result.settings.userOpenId).toBe('ORIGINAL');
    expect(result.error).toContain('磁盘');
    expect(result.operation).toBe('');
  });

  it('requires explicit test sending, records partial results and never confirms an incomplete test', async () => {
    const { service } = serviceFixture();
    service.settings.userOpenId = 'USER';
    expect(fixture.requests).toHaveLength(0);
    fixture.errors['/v2/users/USER/upload_prepare'] = { status: 500, body: { detail: 'image failed' } };
    const partial = await service.sendTest();
    expect(partial.testSent).toBe(false);
    expect(partial.records[0]).toMatchObject({ text: 'submitted', image: 'failed' });
    expect(() => service.confirmTest()).toThrow('图文');
    delete fixture.errors['/v2/users/USER/upload_prepare'];
    expect((await service.sendTest()).testSent).toBe(true);
    expect(service.confirmTest().testConfirmed).toBe(true);
    service.update({ groupEnabled: true });
    expect(service.snapshot()).toMatchObject({ ready: false, testSent: false, testConfirmed: false });
  });

  it('does not downgrade a missing image test to a text-only message', () => {
    const { service } = serviceFixture(); service.settings.userOpenId = 'USER';
    service.makeTestImage = () => Buffer.alloc(0);
    expect(() => service.sendTest()).toThrow('测试图片');
    expect(fixture.requests).toHaveLength(0);
  });

  it('clearing a saved secret also releases the previous credentials and token in the client', async () => {
    const { service } = serviceFixture();
    await service.verify();
    service.update({ secret: '', rememberSecret: false });
    expect(client.secret).toBe('');
    expect(client.token).toBe('');
    expect(service.snapshot().hasSecret).toBe(false);
  });

  it('rejects other windows and subframes at the IPC boundary; secrets stay out of state', () => {
    const handlers = new Map(), sender = { mainFrame: {}, send() {}, isDestroyed: () => false };
    const service = registerQQNotifications({ ipcMain: { handle: (name, action) => handlers.set(name, action) },
      getMainWindow: () => ({ isDestroyed: () => false, webContents: sender }), store: memoryStore(), client, makeImage: () => Buffer.from('image') });
    expect(() => handlers.get('qq:save')({ sender: {}, senderFrame: {} }, {})).toThrow('Unknown');
    expect(() => handlers.get('qq:test')({ sender, senderFrame: {} })).toThrow('Unknown');
    const event = { sender, senderFrame: sender.mainFrame };
    handlers.get('qq:save')(event, { appId: 'A', secret: 'TEST_SECRET' });
    expect(JSON.stringify(handlers.get('qq:state')(event))).not.toContain('TEST_SECRET');
    expect(handlers.has('qq:send')).toBe(false);
    service.close();
  });
});
