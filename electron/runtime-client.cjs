const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');

// One supervised child per hardware role. A stalled video driver never kills the controller.
class RuntimeClient extends EventEmitter {
  constructor({ role = 'video', executable, testMode = false } = {}) {
    super();
    this.role = role;
    this.executable = executable || process.env.AUTO_POKE_RUNTIME || path.join(__dirname, '..', 'runtime', 'bin', 'Release', 'poke-runtime.exe');
    this.testMode = testMode;
    this.pending = new Map(); this.counter = 0; this.child = null; this.starting = null;
  }
  async start() {
    if (this.starting) return this.starting;
    if (this.child) return;
    if (!fs.existsSync(this.executable)) throw new Error('设备运行时尚未构建，请先运行 npm run build:runtime。');
    this.starting = new Promise((resolve, reject) => {
      const child = spawn(this.executable, ['--role', this.role, '--parent-pid', String(process.pid), ...(this.testMode ? ['--test-mode'] : [])], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, OPENCV_LOG_LEVEL: 'ERROR' },
      });
      this.child = child;
      let buffer = '', ready = false, diagnostic = '';
      const timer = setTimeout(() => { reject(new Error('设备运行时启动超时。')); this.terminate(); }, 10000);
      const fail = error => {
        clearTimeout(timer);
        if (this.child !== child) return;
        this.child = null; this.starting = null;
        for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
        this.pending.clear();
        if (!ready) reject(error);
        this.emit('offline', error);
      };
      child.once('error', fail);
      child.once('exit', (code, signal) => fail(new Error(`设备运行时已退出（${code ?? signal}）${diagnostic ? '：' + diagnostic : ''}`)));
      child.stdin.on('error', error => { fail(error); child.kill(); });
      child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString('utf8')).slice(-2000); });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 2 * 1024 * 1024) { fail(new Error('运行时响应超过限制。')); child.kill(); return; }
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          let message;
          try { message = JSON.parse(line); } catch { fail(new Error('运行时协议响应无效。')); child.kill(); return; }
          if (message.event === 'runtime.ready') {
            if (message.protocol !== 1 || message.role !== this.role) { fail(new Error('运行时协议版本不匹配。')); child.kill(); return; }
            ready = true; clearTimeout(timer); resolve();
          } else if (message.event) this.emit('event', message);
          else {
            const request = this.pending.get(message.id);
            if (request) {
              clearTimeout(request.timer); this.pending.delete(message.id);
              if (message.ok) request.resolve(message.result);
              else request.reject(Object.assign(new Error(message.error?.message || '设备操作失败。'), { code: message.error?.code }));
            }
          }
        }
      });
    });
    try { await this.starting; } finally { this.starting = null; }
  }
  async call(method, params = {}, timeout = 5000) {
    await this.start();
    const child = this.child;
    if (!child || child.killed) throw new Error('设备运行时不可用。');
    if (this.pending.size >= 128) throw new Error('设备请求过多，请稍后再试。');
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new Error('设备响应超时，连接已关闭，请重新连接。')); this.terminate();
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ version: 1, id, method, params }) + '\n');
    });
  }
  terminate() { this.child?.kill(); }
  async close() {
    if (!this.child) return;
    const child = this.child;
    try { await this.call('shutdown', {}, 2000); } catch { /* force only our child */ }
    if (child.exitCode !== null) return;
    await new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve(); }, 2000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
  }
}
module.exports = { RuntimeClient };
