// SPDX-License-Identifier: GPL-3.0-or-later
// Protocol adapted from auto-bdsp-rng/notifications/qq_client.py (GPL-3.0-or-later).
// Upstream protocol reference: BetterGI f29966868c6e2d5b8798bb6a4f3df201ec4a5f95.
const { createHash, randomInt } = require('node:crypto');
const WebSocket = require('ws');

class QQClient {
  constructor({ apiBase = 'https://api.sgroup.qq.com', tokenUrl = 'https://bots.qq.com/app/getAppAccessToken',
    requestTimeout = 20000, bindingLifetime = 60000, allowInsecure = false } = {}) {
    Object.assign(this, { apiBase, tokenUrl, requestTimeout, bindingLifetime, allowInsecure });
    this.appId = ''; this.secret = ''; this.token = ''; this.expires = 0;
  }

  configure(appId, secret) {
    if (!appId || !secret) throw new Error('请填写 AppID 和 AppSecret。');
    if (appId !== this.appId || secret !== this.secret) { this.token = ''; this.expires = 0; }
    this.appId = appId; this.secret = secret;
  }

  redact(value) {
    let message = String(value?.message || value);
    for (const secret of [this.secret, this.token]) if (secret) message = message.split(secret).join('[已隐藏]');
    return message.slice(0, 1000);
  }

  async request(method, url, body, { token = '', raw = false, signal } = {}) {
    const address = new URL(url);
    if (address.username || address.password || !(address.protocol === 'https:' || (this.allowInsecure && address.protocol === 'http:'))) {
      throw new Error('QQ 接口返回了无效或不安全的地址。');
    }
    try {
      const response = await fetch(address, {
        method, redirect: 'manual',
        headers: { 'Content-Type': raw ? 'application/octet-stream' : 'application/json', ...(token ? { Authorization: `QQBot ${token}` } : {}) },
        body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.requestTimeout)]) : AbortSignal.timeout(this.requestTimeout),
      });
      const text = await response.text();
      if (!response.ok) {
        const detail = this.redact(text || response.statusText);
        if (response.status === 401) { this.token = ''; this.expires = 0; }
        throw new Error(`HTTP ${response.status}：${detail}`);
      }
      const result = raw || !text ? {} : JSON.parse(text);
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('QQ 接口返回了无效数据。');
      if (result.code !== undefined && ![0, '0'].includes(result.code)) throw new Error(`QQ API 错误：${this.redact(JSON.stringify(result))}`);
      return result;
    } catch (error) {
      if (signal?.aborted) throw new Error('操作已取消；已提交的消息可能已经送达，请在 QQ 中核对。');
      if (error.name === 'TimeoutError') throw new Error('QQ 请求超时；消息可能已经提交，请在 QQ 中核对。');
      throw new Error(this.redact(error));
    }
  }

  async accessToken(signal, refresh = false) {
    if (!refresh && this.token && performance.now() < this.expires) return this.token;
    const result = await this.request('POST', this.tokenUrl, { appId: this.appId, clientSecret: this.secret }, { signal });
    if (typeof result.access_token !== 'string' || !result.access_token) throw new Error('QQ 接口未返回访问令牌。');
    this.token = result.access_token;
    const seconds = Number(result.expires_in);
    this.expires = performance.now() + (Number.isFinite(seconds) ? Math.max(0, seconds - Math.min(60, seconds / 2)) * 1000 : 0);
    return this.token;
  }

  async verify(signal) { await this.accessToken(signal, true); }

  async bind(kind, { signal, onBinding = () => {} } = {}) {
    if (!['user', 'group'].includes(kind)) throw new Error('绑定类型无效。');
    const token = await this.accessToken(signal);
    const gateway = await this.request('GET', this.apiBase + '/gateway', undefined, { token, signal });
    const address = new URL(gateway.url);
    if (address.username || address.password || !(address.protocol === 'wss:' || (this.allowInsecure && address.protocol === 'ws:'))) throw new Error('QQ 网关地址无效。');
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(address, { handshakeTimeout: this.requestTimeout, maxPayload: 2 * 1024 * 1024, followRedirects: false });
      let settled = false, ready = false, identified = false, awaitingAck = false, sequence = null;
      let code = '', expires = 0, generation = 0, seconds = -1, heartbeat;
      const finish = (error, openId) => {
        if (settled) return;
        settled = true;
        clearInterval(ticker); clearInterval(heartbeat); clearTimeout(deadline);
        signal?.removeEventListener('abort', abort);
        onBinding(null);
        socket.terminate();
        if (error) reject(new Error(this.redact(error))); else resolve(openId);
      };
      const abort = () => finish(new Error('绑定已取消。'));
      const send = data => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); };
      const renew = () => {
        let next;
        do { next = String(randomInt(100000, 1000000)); } while (next === code);
        code = next; generation++; seconds = -1; expires = performance.now() + this.bindingLifetime;
      };
      const tick = () => {
        if (!ready || settled) return;
        if (performance.now() >= expires) renew();
        const remaining = Math.max(0, Math.ceil((expires - performance.now()) / 1000));
        if (seconds !== remaining) { seconds = remaining; onBinding({ kind, code, seconds, generation }); }
      };
      const beat = (check = true) => {
        if (check && awaitingAck) { finish(new Error('QQ 网关心跳未响应，请重新绑定。')); return; }
        send({ op: 1, d: sequence }); awaitingAck = true;
      };
      const ticker = setInterval(tick, 200);
      const deadline = setTimeout(() => finish(new Error('连接 QQ 网关超时，请重新绑定。')), this.requestTimeout);
      signal?.addEventListener('abort', abort, { once: true });
      socket.on('error', () => finish(new Error('QQ 网关连接失败，请检查网络后重新绑定。')));
      socket.on('close', () => finish(new Error('QQ 网关连接已断开，请重新绑定。')));
      socket.on('message', raw => {
        if (settled) return;
        try {
          const packet = JSON.parse(raw.toString());
          const data = packet.d || {};
          if (packet.s !== undefined) sequence = packet.s;
          if (packet.op === 10 && !identified) {
            const interval = Number(data.heartbeat_interval);
            if (!Number.isInteger(interval) || interval < 1 || interval > 2147483647) throw new Error('QQ 网关心跳间隔无效。');
            identified = true;
            send({ op: 2, d: { token: 'QQBot ' + token, intents: 1 << 25, shard: [0, 1] } });
            heartbeat = setInterval(() => beat(), interval);
          } else if (packet.op === 11) awaitingAck = false;
          else if (packet.op === 1) beat(false);
          else if ([7, 9].includes(packet.op)) throw new Error('QQ 网关要求重连或鉴权失败，请重新验证凭据。');
          else if (packet.op === 0) {
            if (packet.t === 'READY' && identified && !ready) { ready = true; clearTimeout(deadline); renew(); tick(); return; }
            if (!ready) return;
            const events = kind === 'user' ? ['C2C_MESSAGE_CREATE'] : ['GROUP_AT_MESSAGE_CREATE', 'GROUP_MESSAGE_CREATE'];
            if (!events.includes(packet.t)) return;
            tick(); // Expired codes must fail even if the timer has not fired yet.
            if (!new RegExp(`(?<!\\d)${code}(?!\\d)`).test(String(data.content || ''))) return;
            const openId = kind === 'user' ? data.author?.user_openid : data.group_openid;
            if (typeof openId !== 'string' || !openId.trim()) throw new Error('绑定消息缺少 OpenID。');
            finish(null, openId.trim());
          }
        } catch (error) { finish(error); }
      });
      if (signal?.aborted) abort();
    });
  }

  async uploadImage(base, token, image, signal) {
    const hash = (algorithm, data) => createHash(algorithm).update(data).digest('hex');
    const call = (suffix, body) => this.request('POST', base + suffix, body, { token, signal });
    const prepared = await call('/upload_prepare', {
      file_type: 1, file_size: String(image.length), file_name: 'notification.jpg',
      md5: hash('md5', image), sha1: hash('sha1', image), md5_10m: hash('md5', image.subarray(0, 10002432)),
    });
    const size = Number(prepared.block_size), parts = prepared.parts;
    if (!Number.isSafeInteger(size) || size <= 0 || !Array.isArray(parts) || !prepared.upload_id) throw new Error('图片上传分片信息无效。');
    const indexes = parts.map(part => Number(part.index)).sort((a, b) => a - b);
    if (indexes.length !== Math.ceil(image.length / size) || indexes.some((index, i) => index !== i + 1)) throw new Error('图片上传分片列表不完整。');
    for (const part of parts) {
      const index = Number(part.index), chunk = image.subarray((index - 1) * size, index * size);
      // Presigned upload URLs must never receive the bot's bearer token.
      await this.request('PUT', part.presigned_url, chunk, { raw: true, signal });
      await call('/upload_part_finish', { upload_id: prepared.upload_id, part_index: index, block_size: String(chunk.length), md5: hash('md5', chunk) });
    }
    const result = await call('/files', { file_type: 1, upload_id: prepared.upload_id });
    if (typeof result.file_info !== 'string' || !result.file_info) throw new Error('图片上传未返回媒体信息。');
    return result.file_info;
  }

  async send(targets, text, image, { signal, onDelivery = () => {} } = {}) {
    if (!targets.length || targets.some(item => !['user', 'group'].includes(item.kind) || !item.openId)) throw new Error('请绑定并选择接收方。');
    if (typeof text !== 'string' || text.length > 2000 || (!text.trim() && !image?.length)) throw new Error('通知需包含文字或图片，文字最多 2000 字。');
    if (image && (!Buffer.isBuffer(image) || !image.length || image.length > 10 * 1024 * 1024)) throw new Error('通知图片需为不超过 10 MB 的图片数据。');
    const results = [];
    for (const { kind, openId } of targets) {
      const result = { kind, text: 'skipped', image: 'skipped', success: false, detail: '' };
      try {
        if (signal?.aborted) throw new Error('操作已取消。');
        const token = await this.accessToken(signal);
        const base = this.apiBase + (kind === 'user' ? '/v2/users/' : '/v2/groups/') + encodeURIComponent(openId);
        if (text.trim()) {
          result.text = 'failed';
          await this.request('POST', base + '/messages', { msg_type: 0, content: text.trim() }, { token, signal });
          result.text = 'submitted';
        }
        if (image) {
          result.image = 'failed';
          const fileInfo = await this.uploadImage(base, token, image, signal);
          await this.request('POST', base + '/messages', { msg_type: 7, media: { file_info: fileInfo } }, { token, signal });
          result.image = 'submitted';
        }
        result.success = true;
        result.detail = '接口已接受，请在 QQ 中确认收到。';
      } catch (error) { result.detail = this.redact(error); }
      results.push(result); onDelivery(result);
    }
    return results;
  }
}

module.exports = { QQClient };
