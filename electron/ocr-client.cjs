const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function pythonPath() {
  const bundled = process.platform === 'win32'
    ? path.join(__dirname, '..', '.deps', 'script-python', 'Scripts', 'python.exe')
    : path.join(__dirname, '..', '.deps', 'script-python', 'bin', 'python');
  return process.env.AUTO_POKE_PYTHON || (fs.existsSync(bundled) ? bundled : 'python');
}

class OcrClient {
  constructor() {
    this.child = null;
    this.starting = null;
    this.pending = new Map();
    this.counter = 0;
  }

  async start() {
    if (this.starting) return this.starting;
    if (this.child) return;
    this.starting = new Promise((resolve, reject) => {
      const child = spawn(pythonPath(), ['-u', path.join(__dirname, '..', 'runtime', 'python', 'ocr_service.py')], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
      });
      this.child = child;
      let buffer = '';
      let diagnostic = '';
      let ready = false;
      let settled = false;
      let failed = false;
      const timer = setTimeout(() => fail(new Error('OCR 引擎启动超时。')), 30000);
      const fail = error => {
        if (failed) return;
        failed = true; settled = true;
        clearTimeout(timer);
        if (this.child === child) this.child = null;
        if (!ready) reject(error);
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
        this.pending.clear();
      };
      child.once('error', error => fail(error));
      child.once('exit', (code, signal) => {
        fail(new Error(`OCR 引擎已退出（${code ?? signal}）${diagnostic ? '：' + diagnostic : ''}`));
      });
      child.stdin.on('error', error => { fail(error); child.kill(); });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-2000); });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 2 * 1024 * 1024) { fail(new Error('OCR 响应超过限制。')); child.kill(); return; }
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          let message;
          try { message = JSON.parse(line); } catch { fail(new Error('OCR 响应协议无效。')); child.kill(); return; }
          if (message.event === 'ocr.ready') {
            ready = true; settled = true; clearTimeout(timer); resolve();
          } else if (message.event === 'ocr.error' && !ready) {
            fail(new Error(message.message || 'OCR 引擎初始化失败。')); child.kill();
          } else if (typeof message.id === 'number') {
            const request = this.pending.get(message.id);
            if (!request) continue;
            clearTimeout(request.timer); this.pending.delete(message.id);
            if (message.ok) request.resolve(message.result);
            else request.reject(new Error(message.error?.message || 'OCR 识别失败。'));
          }
        }
      });
    });
    try { await this.starting; } finally { this.starting = null; }
  }

  async read(imageBase64, language = '') {
    if (typeof imageBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64) || Buffer.byteLength(imageBase64, 'base64') > MAX_IMAGE_BYTES) {
      throw new Error('OCR 图像无效或过大。');
    }
    await this.start();
    const child = this.child;
    if (!child || child.killed || child.stdin.destroyed) throw new Error('OCR 引擎不可用。');
    if (this.pending.size >= 32) throw new Error('OCR 请求过多，请稍后再试。');
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new Error('OCR 识别超时。')); this.close();
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ version: 1, id, params: { imageBase64, language } }) + '\n');
    });
  }

  async close() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('OCR 引擎已关闭。')); }
    this.pending.clear();
    child.kill();
  }
}

module.exports = { OcrClient };
