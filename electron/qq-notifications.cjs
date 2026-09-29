// SPDX-License-Identifier: GPL-3.0-or-later
// Adapted from auto-bdsp-rng's QQ notification service; see docs/QQ_NOTIFICATIONS.md.
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { QQClient } = require('./qq-client.cjs');

const defaults = () => ({
  appId: '', secret: '', rememberSecret: false, userOpenId: '', groupOpenId: '', userEnabled: true, groupEnabled: false,
  notifyCompleted: true, notifyFailed: true, notifyStopped: false, attachImage: true,
});

class QQSettingsStore {
  constructor(file, safeStorage) { this.file = file; this.safeStorage = safeStorage; this.warning = ''; }
  load() {
    const settings = defaults();
    try {
      if (!fs.existsSync(this.file)) return settings;
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const key of Object.keys(settings)) if (key !== 'secret' && typeof data[key] === typeof settings[key]) settings[key] = data[key];
      if (settings.rememberSecret && data.protectedSecret) {
        if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Encryption unavailable');
        settings.secret = this.safeStorage.decryptString(Buffer.from(data.protectedSecret, 'base64'));
      }
    } catch { this.warning = '无法读取 QQ 配置或解密密钥，请检查并重新保存接入设置。'; }
    return settings;
  }
  save(settings) {
    const { secret, ...data } = settings;
    if (data.rememberSecret && secret) {
      if (!this.safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，请取消“记住密钥”后保存。');
      try { data.protectedSecret = this.safeStorage.encryptString(secret).toString('base64'); }
      catch { throw new Error('密钥加密失败，请取消“记住密钥”后保存。'); }
    }
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } catch { throw new Error('QQ 配置保存失败，请检查配置目录的写入权限后重试。'); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
}

class QQNotificationService extends EventEmitter {
  constructor({ store, client = new QQClient(), makeTestImage }) {
    super();
    this.store = store; this.client = client; this.makeTestImage = makeTestImage;
    this.settings = { ...defaults(), ...(store.load() || {}) }; this.records = []; this.operation = ''; this.binding = null;
    this.verified = false; this.testSent = false; this.testConfirmed = false;
    this.error = store.warning || ''; this.feedback = this.error || '填写机器人凭据，开始配置 QQ 通知。'; this.closed = false;
    this.notificationQueue = []; this.notificationActive = null; this.notificationRuns = new Set();
  }
  targets() {
    return ['user', 'group'].filter(kind => this.settings[kind + 'Enabled']).map(kind => ({ kind, openId: this.settings[kind + 'OpenId'] }));
  }
  snapshot() {
    const { secret, ...settings } = this.settings;
    const targets = this.targets();
    const ready = Boolean(settings.appId && secret && targets.length && targets.every(target => target.openId));
    const status = this.error ? 'failed' : this.operation ? 'busy' : !settings.appId || !secret ? 'unconfigured' : !this.verified ? 'unverified' : ready ? 'ready' : 'unbound';
    return { settings, hasSecret: Boolean(secret), ready, verified: this.verified, operation: this.operation,
      binding: this.binding, feedback: this.feedback, error: this.error, status,
      testSent: this.testSent, testConfirmed: this.testConfirmed, records: this.records.map(record => ({ ...record })) };
  }
  changed() { this.emit('changed', this.snapshot()); }
  requireIdle() {
    if (this.closed) throw new Error('QQ 通知服务已关闭。');
    if (this.operation) throw new Error('请先等待当前操作结束或取消。');
  }
  resetTest() { this.testSent = false; this.testConfirmed = false; }
  update(values) {
    this.requireIdle();
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('配置格式无效。');
    const next = { ...this.settings };
    for (const [key, value] of Object.entries(values)) {
      if (!['appId', 'secret', 'rememberSecret', 'userEnabled', 'groupEnabled', 'notifyCompleted', 'notifyFailed', 'notifyStopped', 'attachImage'].includes(key) || typeof value !== typeof next[key]) throw new Error('QQ 配置字段无效。');
      next[key] = typeof value === 'string' ? value.trim() : value;
    }
    if (next.appId.length > 128 || next.secret.length > 512) throw new Error('AppID 或 AppSecret 过长，请检查输入。');
    const changedId = next.appId !== this.settings.appId;
    if (changedId) { next.userOpenId = ''; next.groupOpenId = ''; if (values.secret === undefined) next.secret = ''; }
    const changedCredentials = changedId || next.secret !== this.settings.secret;
    this.store.save(next); // Commit memory only after the atomic save succeeds.
    this.settings = next;
    if (changedCredentials) {
      for (const item of this.notificationQueue.splice(0)) item.resolve(false);
      this.notificationRuns.clear();
      this.verified = false; this.client.appId = next.appId; this.client.secret = next.secret;
      this.client.token = ''; this.client.expires = 0;
    }
    this.resetTest(); this.error = ''; this.feedback = '配置已保存。' + (next.rememberSecret ? '密钥使用系统加密保存。' : '密钥仅在本次打开期间使用。');
    this.changed(); return this.snapshot();
  }
  unbind(kind) {
    this.requireIdle();
    if (!['user', 'group'].includes(kind)) throw new Error('绑定类型无效。');
    const next = { ...this.settings, [kind + 'OpenId']: '', [kind + 'Enabled']: false };
    this.store.save(next); this.settings = next; this.resetTest(); this.error = ''; this.feedback = '已解除本软件保存的绑定。';
    this.changed(); return this.snapshot();
  }
  async perform(operation, action) {
    this.requireIdle();
    this.client.configure(this.settings.appId, this.settings.secret);
    this.abortController = new AbortController(); this.operation = operation; this.error = '';
    this.feedback = { verify: '正在验证机器人凭据…', bind: '正在连接 QQ 网关…', test: '正在发送图文测试…', send: '正在发送通知…' }[operation];
    this.changed();
    try { await action(this.abortController.signal); }
    catch (error) {
      this.feedback = this.client.redact(error);
      if (!this.abortController.signal.aborted) this.error = this.feedback;
    } finally {
      this.operation = ''; this.binding = null; this.abortController = null; this.changed();
      this.drainNotifications();
    }
    return this.snapshot();
  }
  verify() {
    return this.perform('verify', async signal => {
      this.verified = false;
      await this.client.verify(signal); this.verified = true;
      this.feedback = '凭据验证成功，可以绑定接收方。';
    });
  }
  bind(kind) {
    if (!this.verified) throw new Error('请先验证机器人凭据。');
    return this.perform('bind', async signal => {
      const openId = await this.client.bind(kind, { signal, onBinding: value => {
        this.binding = value;
        if (value) this.feedback = '正在等待' + (kind === 'user' ? '私聊' : '群聊') + '中的当前绑定码…';
        this.changed();
      } });
      const next = { ...this.settings, [kind + 'OpenId']: openId, [kind + 'Enabled']: true };
      this.store.save(next); this.settings = next; this.resetTest();
      this.feedback = (kind === 'user' ? '私聊' : '群聊') + '绑定成功，接收方已保存。';
    });
  }
  // Automatic workflow completion is queued through notifyTask; this low-level method remains reusable for tests.
  send({ text, image, event = '通知' }, operation = 'send') {
    this.requireIdle();
    if (!this.snapshot().ready) throw new Error('请填写凭据，并绑定所有勾选的接收方。');
    const targets = this.targets();
    return this.perform(operation, async signal => {
      const results = await this.client.send(targets, text, image, { signal, onDelivery: result => {
        this.records.unshift({ id: randomUUID(), time: new Date().toISOString(), event, ...result });
        this.records = this.records.slice(0, 100); this.changed();
      } });
      const ok = results.every(result => result.success);
      if (operation === 'test') this.testSent = ok;
      if (!ok) throw new Error(results.filter(result => !result.success).map(result => (result.kind === 'user' ? '私聊：' : '群聊：') + result.detail).join('；'));
      this.feedback = '通知已提交。请在 QQ 中核对实际接收情况。';
    });
  }
  sendTest() {
    this.requireIdle(); this.resetTest();
    const image = this.makeTestImage();
    if (!Buffer.isBuffer(image) || !image.length) throw new Error('测试图片不可用，未发送测试消息。');
    return this.send({ event: '图文测试', text: 'Auto Poke RNG · QQ 通知测试\n请确认同时收到这条文字和测试图片。', image }, 'test');
  }

  wantsTaskImage(outcome) {
    const policy = { completed: 'notifyCompleted', failed: 'notifyFailed', stopped: 'notifyStopped' }[outcome];
    return !this.closed && Boolean(policy) && this.settings.attachImage === true && this.settings[policy] === true && this.snapshot().ready;
  }

  notifyTask(runId, task, outcome, { target = '', detail = '', image } = {}) {
    const policy = { completed: 'notifyCompleted', failed: 'notifyFailed', stopped: 'notifyStopped' }[outcome];
    if (this.closed || !policy || this.settings[policy] === false || (outcome === 'stopped' && this.settings[policy] !== true)
      || this.notificationRuns.has(runId) || !this.snapshot().ready) return Promise.resolve(false);
    if (this.notificationQueue.length >= 20) {
      this.emit('log', 'QQ 通知队列已满，已跳过本次自动通知。', 'warning');
      return Promise.resolve(false);
    }
    this.notificationRuns.add(runId);
    if (this.notificationRuns.size > 400) this.notificationRuns = new Set([...this.notificationRuns].slice(-200));
    const labels = { completed: '任务完成', failed: '任务异常', stopped: '手动停止' };
    const lines = [`${task} · ${labels[outcome]}`, `结果：${outcome === 'completed' ? '已完成' : outcome === 'failed' ? '失败' : '已停止'}`];
    if (target) lines.push(`目标：${String(target).slice(0, 240)}`);
    if (detail) lines.push(`详情：${String(detail).slice(0, 800)}`);
    lines.push('结束时间：' + new Date().toLocaleString('zh-CN', { hour12: false }));
    return new Promise(resolve => {
      this.notificationQueue.push({ runId, event: labels[outcome], text: lines.join('\n'), image: this.settings.attachImage === true ? image : undefined, resolve });
      this.emit('log', `${task}：已加入 QQ 通知队列（${labels[outcome]}）。`, 'info');
      this.drainNotifications();
    });
  }

  async drainNotifications() {
    if (this.closed || this.notificationActive || this.operation || !this.notificationQueue.length) return;
    const item = this.notificationQueue.shift();
    this.notificationActive = item;
    try {
      const state = await this.send({ event: item.event, text: item.text, image: item.image }, 'send');
      const ok = !state.error && state.feedback === '通知已提交。请在 QQ 中核对实际接收情况。';
      this.emit('log', ok ? `${item.event} QQ 通知已提交。` : `${item.event} QQ 通知发送失败：${state.error || state.feedback}`, ok ? 'info' : 'warning');
      item.resolve(ok);
    } catch (error) {
      const message = this.client.redact(error);
      this.emit('log', `${item.event} QQ 通知发送失败：${message}`, 'warning');
      item.resolve(false);
    } finally {
      this.notificationActive = null;
      this.drainNotifications();
    }
  }
  confirmTest() {
    this.requireIdle();
    if (!this.testSent) throw new Error('请先成功提交图文测试。');
    this.testConfirmed = true; this.feedback = '已确认收到文字和图片，QQ 通知配置完成。';
    this.changed(); return this.snapshot();
  }
  cancel(bindingOnly = false) {
    if (!bindingOnly || this.operation === 'bind') this.abortController?.abort();
    return this.snapshot();
  }
  close() {
    this.closed = true;
    for (const item of this.notificationQueue.splice(0)) item.resolve(false);
    this.cancel();
  }
}

function makeTestImage(nativeImage) {
  // A bundled, deterministic test card; no screenshot or external asset needed.
  const width = 480, height = 270, pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const radius = Math.hypot(x - 240, y - 135);
    let rgb = [25, 28, 30];
    if (x >= 32 && x < 448 && y >= 24 && y < 246) rgb = [35, 42, 44];
    if (radius < 82) rgb = y < 129 ? [132, 179, 154] : y > 141 ? [220, 222, 222] : [25, 28, 30];
    if (radius < 29) rgb = [25, 28, 30];
    if (radius < 19) rgb = [220, 222, 222];
    const i = (y * width + x) * 4;
    pixels[i] = rgb[2]; pixels[i + 1] = rgb[1]; pixels[i + 2] = rgb[0]; pixels[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(pixels, { width, height }).toJPEG(88);
}

function registerQQNotifications({ ipcMain, getMainWindow, store, client, makeImage, safeStorage, nativeImage, userData }) {
  const service = new QQNotificationService({ store: store || new QQSettingsStore(path.join(userData, 'qq-notifications.json'), safeStorage), client,
    makeTestImage: makeImage || (() => makeTestImage(nativeImage)) });
  const handle = (name, action) => ipcMain.handle('qq:' + name, (event, args) => {
    const window = getMainWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Unknown QQ notification sender');
    return action(args);
  });
  handle('state', () => service.snapshot());
  handle('save', args => service.update(args));
  handle('verify', () => service.verify());
  handle('bind', kind => service.bind(kind));
  handle('unbind', kind => service.unbind(kind));
  handle('test', () => service.sendTest());
  handle('confirm', () => service.confirmTest());
  handle('cancel', bindingOnly => service.cancel(bindingOnly === true));
  service.on('changed', state => {
    const window = getMainWindow();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('qq:state', state);
  });
  return service;
}

module.exports = { QQSettingsStore, QQNotificationService, registerQQNotifications, makeTestImage };
