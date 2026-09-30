const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');

function pythonPath() {
  const bundled = path.join(__dirname, '..', '.deps', 'script-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return process.env.AUTO_POKE_PYTHON || (fs.existsSync(bundled) ? bundled : 'python');
}

class FrlgRngClient extends EventEmitter {
  constructor({ sourceRoot } = {}) {
    super();
    this.sourceRoot = sourceRoot;
    this.child = null;
    this.pending = new Map();
    this.counter = 0;
    this.buffer = '';
  }
  start() {
    if (this.child && !this.child.killed) return;
    this.buffer = '';
    const child = spawn(pythonPath(), ['-u', path.join(__dirname, '..', 'runtime', 'python', 'frlg_rng_host.py')], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', ...(this.sourceRoot ? { FRLG_AUTO_RNG_ROOT: this.sourceRoot } : {}) },
    });
    this.child = child;
    let diagnostic = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => this.onData(chunk));
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-4000); });
    const fail = error => {
      if (this.child !== child) return;
      this.child = null;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
      this.pending.clear();
      this.emit('offline', error);
    };
    child.once('error', fail);
    child.once('exit', (code, signal) => fail(new Error(diagnostic || `FRLG RNG 进程已退出（${code ?? signal}）`)));
    child.stdin.on('error', fail);
  }
  onData(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 64 * 1024 * 1024) { this.close(); return; }
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
      let message;
      try { message = JSON.parse(line); } catch { this.close(); return; }
      const request = this.pending.get(message.id);
      if (!request) continue;
      clearTimeout(request.timer); this.pending.delete(message.id);
      if (message.ok) request.resolve(message.result);
      else request.reject(new Error(message.error?.message || 'FRLG RNG 请求失败。'));
    }
  }
  call(method, params = {}, timeout = 120000) {
    this.start();
    if (!this.child || this.child.killed) return Promise.reject(new Error('FRLG RNG 进程不可用。'));
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('FRLG RNG 搜索超时。')); this.close(); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ version: 1, id, method, params }) + '\n');
    });
  }
  close() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('FRLG RNG 搜索已取消。')); }
    this.pending.clear();
    child.kill();
  }
}

function registerFrlgRng({ ipcMain, getMainWindow, sourceRoot, isBusy = () => false, client = new FrlgRngClient({ sourceRoot }) }) {
  const requireWindow = event => {
    if (!event.sender || event.sender !== getMainWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Unknown FRLG RNG sender');
  };
  ipcMain.handle('frlg-rng:validate', async (event, request) => { requireWindow(event); if (isBusy()) throw new Error('请先停止其他自动流程。'); return client.call('validate', request, 15000); });
  ipcMain.handle('frlg-rng:search', async (event, request) => { requireWindow(event); if (isBusy()) throw new Error('请先停止其他自动流程。'); return client.call('search', request); });
  ipcMain.handle('frlg-rng:cancel', async event => { requireWindow(event); if (isBusy()) throw new Error('请使用自动流程的停止按钮。'); client.close(); });
  return { client, close: async () => client.close(), isBusy: () => client.pending.size > 0 };
}

module.exports = { FrlgRngClient, registerFrlgRng, pythonPath };
