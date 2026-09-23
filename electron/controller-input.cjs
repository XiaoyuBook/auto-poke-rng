const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

function keyCodeToVirtualKey(code) {
  if (!code) return null;
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
  if (/^Numpad[0-9]$/.test(code)) return 0x60 + Number(code.slice(6));
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return 0x6f + Number(code.slice(1));
  const values = {
    Escape: 0x1b, Enter: 0x0d, NumpadEnter: 0x0d, Space: 0x20, Tab: 0x09, Backspace: 0x08,
    ArrowUp: 0x26, ArrowDown: 0x28, ArrowLeft: 0x25, ArrowRight: 0x27,
    Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22, Insert: 0x2d, Delete: 0x2e,
    ShiftLeft: 0xa0, ShiftRight: 0xa1, ControlLeft: 0xa2, ControlRight: 0xa3,
    AltLeft: 0xa4, AltRight: 0xa5, MetaLeft: 0x5b, MetaRight: 0x5c,
    CapsLock: 0x14, NumLock: 0x90, ScrollLock: 0x91,
    Equal: 0xbb, Minus: 0xbd, BracketLeft: 0xdb, BracketRight: 0xdd,
    Backslash: 0xdc, Semicolon: 0xba, Quote: 0xde, Backquote: 0xc0,
    Comma: 0xbc, Period: 0xbe, Slash: 0xbf, NumpadAdd: 0x6b, NumpadSubtract: 0x6d,
    NumpadMultiply: 0x6a, NumpadDivide: 0x6f, ContextMenu: 0x5d,
  };
  return values[code] ?? null;
}

function stickValue(directions) {
  const up = directions.has('UP'), down = directions.has('DOWN');
  const left = directions.has('LEFT'), right = directions.has('RIGHT');
  return {
    x: left && !right ? 0 : right && !left ? 255 : 128,
    y: up && !down ? 0 : down && !up ? 255 : 128,
  };
}

class ControllerInputManager extends EventEmitter {
  constructor({ controller, broadcast }) {
    super();
    this.controller = controller;
    this.broadcast = broadcast;
    this.state = { visible: false, active: false, mode: 'off', scale: 1 };
    this.mapping = {};
    this.codeToAction = new Map();
    this.pressedButtons = new Set();
    this.sticks = { LS: new Set(), RS: new Set() };
    this.child = null;
    this.starting = null;
    this.pending = Promise.resolve();
    this.connected = false;
    this.locked = false;
    controller.on('event', message => {
      if (message.event !== 'controller.state') return;
      const next = message.state || {};
      this.connected = next.status === 'connected';
      this.locked = Boolean(next.running || next.owned);
      if (!this.connected) {
        void this.releaseAll();
        this.setState({ active: false, mode: this.state.visible ? 'standby' : 'off' });
      } else if (this.locked && this.state.active) {
        void this.setActive(false);
      }
    });
    controller.on('offline', () => {
      this.connected = false;
      void this.releaseAll();
      this.setState({ active: false, mode: this.state.visible ? 'standby' : 'off' });
    });
  }

  getState() { return { ...this.state }; }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.broadcast(this.state);
  }

  setMapping(mapping) {
    this.mapping = { ...(mapping || {}) };
    this.codeToAction.clear();
    for (const [id, code] of Object.entries(this.mapping)) {
      if (!code) continue;
      const vk = keyCodeToVirtualKey(code);
      if (vk !== null) this.codeToAction.set(vk, id);
    }
    if (this.child) this.sendChild({ command: 'keys', keys: [...this.codeToAction.keys()] });
  }

  async show() {
    if (!this.connected) {
      try {
        const current = await this.controller.call('controller.status');
        this.connected = current?.status === 'connected';
        this.locked = Boolean(current?.running || current?.owned);
      } catch { /* state broadcast will report the failure */ }
    }
    this.setState({ visible: true, mode: this.state.active ? 'active' : 'standby' });
    if (this.connected && !this.locked) await this.setActive(true);
  }

  async hide() {
    await this.setActive(false, true);
  }

  async toggle() {
    if (!this.state.visible) return this.show();
    if (this.state.active) return this.setActive(false, true);
    return this.setActive(true);
  }

  async toggleActive() {
    if (!this.state.visible) return this.show();
    return this.setActive(!this.state.active);
  }

  async setActive(active, hide = false) {
    const wanted = Boolean(active) && this.connected && !this.locked;
    if (wanted) {
      try {
        await this.ensureChild();
        this.sendChild({ command: 'enabled', value: true });
        this.setState({ visible: true, active: true, mode: 'active' });
      } catch (error) {
        this.emit('error', error);
        this.setState({ active: false, mode: this.state.visible ? 'standby' : 'off' });
      }
    } else {
      if (this.child) this.sendChild({ command: 'enabled', value: false });
      await this.releaseAll();
      this.setState({ active: false, visible: hide ? false : this.state.visible, mode: hide ? 'off' : 'standby' });
      if (hide) await this.stopChild();
    }
  }

  async suspend() {
    await this.setActive(false);
    await this.stopChild();
  }

  async ensureChild() {
    if (this.child) return;
    if (this.starting) return this.starting;
    const python = process.env.AUTO_POKE_PYTHON || (fs.existsSync(path.join(__dirname, '..', '.deps', 'script-python', 'Scripts', 'python.exe')) ? path.join(__dirname, '..', '.deps', 'script-python', 'Scripts', 'python.exe') : 'python');
    const script = path.join(__dirname, '..', 'runtime', 'python', 'keyboard_host.py');
    this.starting = new Promise((resolve, reject) => {
      const child = spawn(python, ['-u', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' } });
      this.child = child;
      let buffer = '', diagnostic = '';
      const timer = setTimeout(() => { reject(new Error('系统级键盘捕获启动超时。')); child.kill(); }, 8000);
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      child.once('error', error => { this.child = null; finish(error); });
      child.once('exit', code => {
        if (this.child === child) this.child = null;
        if (code && code !== 0) this.emit('error', new Error(diagnostic || `键盘捕获进程退出（${code}）`));
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-2000); });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          let message; try { message = JSON.parse(line); } catch { continue; }
          if (message.event === 'ready') finish();
          if (message.event === 'key') this.handleKey(message);
          if (message.event === 'error') this.emit('error', new Error(message.message || '键盘捕获失败'));
        }
      });
      child.stdin.on('error', () => {});
      child.stdin.write(JSON.stringify({ command: 'start', keys: [...this.codeToAction.keys()] }) + '\n');
    });
    try { await this.starting; } finally { this.starting = null; }
  }

  sendChild(message) {
    if (this.child && !this.child.stdin.destroyed) this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  handleKey(message) {
    const vk = Number(message.vk), down = Boolean(message.down);
    if (vk === 0x1b) {
      if (!down) return;
      if (message.control) void this.hide();
      else void this.toggleActive();
      return;
    }
    if (!this.state.active || this.locked || !this.connected) return;
    const id = this.codeToAction.get(vk);
    if (!id) return;
    const action = this.mappingAction(id);
    if (!action) return;
    if (action.kind === 'button') {
      if (down && this.pressedButtons.has(action.key)) return;
      if (!down && !this.pressedButtons.has(action.key)) return;
      if (down) this.pressedButtons.add(action.key); else this.pressedButtons.delete(action.key);
      this.enqueue(() => this.controller.call('controller.key', { key: action.key, down }));
    } else {
      const directions = this.sticks[action.side];
      if (down) directions.add(action.direction); else directions.delete(action.direction);
      const value = stickValue(directions);
      this.enqueue(() => this.controller.call('controller.stick', { side: action.side, x: value.x, y: value.y }));
    }
    this.emit('input', { id, action, down, timestamp: Date.now() });
  }

  mappingAction(id) {
    return this.actionById(id);
  }

  actionById(id) {
    const map = {
      A: { kind: 'button', key: 'A' }, B: { kind: 'button', key: 'B' }, X: { kind: 'button', key: 'X' }, Y: { kind: 'button', key: 'Y' },
      L: { kind: 'button', key: 'L' }, R: { kind: 'button', key: 'R' }, ZL: { kind: 'button', key: 'ZL' }, ZR: { kind: 'button', key: 'ZR' },
      Plus: { kind: 'button', key: 'PLUS' }, Minus: { kind: 'button', key: 'MINUS' }, Capture: { kind: 'button', key: 'CAPTURE' }, Home: { kind: 'button', key: 'HOME' },
      LClick: { kind: 'button', key: 'LCLICK' }, RClick: { kind: 'button', key: 'RCLICK' }, Up: { kind: 'button', key: 'UP' }, Down: { kind: 'button', key: 'DOWN' }, Left: { kind: 'button', key: 'LEFT' }, Right: { kind: 'button', key: 'RIGHT' },
      UpLeft: { kind: 'button', key: 'UP_LEFT' }, UpRight: { kind: 'button', key: 'UP_RIGHT' }, DownLeft: { kind: 'button', key: 'DOWN_LEFT' }, DownRight: { kind: 'button', key: 'DOWN_RIGHT' },
      LSUp: { kind: 'stick', side: 'LS', direction: 'UP' }, LSDown: { kind: 'stick', side: 'LS', direction: 'DOWN' }, LSLeft: { kind: 'stick', side: 'LS', direction: 'LEFT' }, LSRight: { kind: 'stick', side: 'LS', direction: 'RIGHT' },
      RSUp: { kind: 'stick', side: 'RS', direction: 'UP' }, RSDown: { kind: 'stick', side: 'RS', direction: 'DOWN' }, RSLeft: { kind: 'stick', side: 'RS', direction: 'LEFT' }, RSRight: { kind: 'stick', side: 'RS', direction: 'RIGHT' },
    };
    return map[id] || null;
  }

  enqueue(action) {
    this.pending = this.pending.then(action).catch(error => this.emit('error', error));
    return this.pending;
  }

  async releaseAll() {
    if (!this.pressedButtons.size && !this.sticks.LS.size && !this.sticks.RS.size) return;
    this.pressedButtons.clear(); this.sticks.LS.clear(); this.sticks.RS.clear();
    if (this.connected) await this.enqueue(() => this.controller.call('controller.reset')).catch(() => {});
  }

  async close() {
    await this.releaseAll();
    await this.stopChild();
  }

  async stopChild() {
    if (this.child) {
      this.sendChild({ command: 'stop' });
      const child = this.child; this.child = null;
      await new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve(); }, 1500); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    }
  }
}

module.exports = { ControllerInputManager, keyCodeToVirtualKey };
