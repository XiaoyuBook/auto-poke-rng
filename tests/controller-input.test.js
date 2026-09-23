import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { ControllerInputManager } from '../electron/controller-input.cjs';

const neutral = { buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 };
const mapping = { A: 'KeyL', LSUp: 'KeyW', LSDown: 'KeyS', LSLeft: 'KeyA', LSRight: 'KeyD', RSRight: 'ArrowRight', UpRight: 'KeyU' };
const managers = [];
afterEach(async () => { await Promise.all(managers.splice(0).map(input => input.close())); });

function fixture({ autoReady = true } = {}) {
  const controller = new EventEmitter();
  controller.call = vi.fn(async method => method === 'controller.status' ? { status: 'connected' } : {});
  const children = [], states = [], errors = [];
  const spawnKeyboard = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.commands = []; child.enabled = false; child.exited = false;
    child.exit = () => { child.exited = true; child.emit('exit', 0); };
    child.kill = vi.fn(child.exit);
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      for (const line of chunk.toString().trim().split('\n')) {
        const command = JSON.parse(line); child.commands.push(command);
        if (command.command === 'enabled') child.enabled = command.value;
        if (command.command === 'stop') queueMicrotask(child.exit);
      }
      done();
    } });
    child.message = message => child.stdout.write(JSON.stringify(message) + '\n');
    if (autoReady) queueMicrotask(() => child.message({ event: 'ready' }));
    children.push(child);
    return child;
  };
  const input = new ControllerInputManager({ controller, broadcast: state => states.push(state), spawnKeyboard });
  input.on('error', error => errors.push(error));
  input.setMapping(mapping);
  const connection = status => controller.emit('event', { event: 'controller.state', state: { status } });
  connection('connected');
  managers.push(input);
  const key = (vk, down) => children.at(-1).message({ event: 'key', vk, down });
  return { input, controller, children, states, errors, connection, key };
}

describe('global keyboard capture lifecycle', () => {
  it.each(['failed', 'idle', 'offline'])('stops the hook immediately on %s and never replays old keys after reconnect', async status => {
    const { input, controller, children, connection, key } = fixture();
    await input.toggle();
    const child = children[0];
    key(87, true); key(76, true);
    if (status === 'offline') controller.emit('offline', new Error('lost runtime'));
    else connection(status);
    expect(input.getState()).toMatchObject({ visible: false, active: false, mode: 'off', inputReport: null });
    expect(child.enabled).toBe(false);
    expect(child.commands.at(-1)).toEqual({ command: 'stop' });
    expect(input.child).toBeNull();
    // Data buffered by a stopped hook must not toggle/re-enable the overlay.
    child.message({ event: 'key', vk: 27, down: true });
    connection('connected');
    await input.pending;
    expect(controller.call).not.toHaveBeenCalled();
    await input.toggle();
    expect(children).toHaveLength(2);
    expect(child.exited).toBe(true);
    expect(input.getInputReport()).toEqual(neutral);
  });

  it('cancels activation when unplugged while the hook is starting', async () => {
    const { input, connection, children, errors } = fixture({ autoReady: false });
    const activation = input.setActive(true);
    connection('failed');
    children[0].message({ event: 'ready' });
    await activation;
    expect(children[0].commands).not.toContainEqual({ command: 'enabled', value: true });
    expect(input.getState()).toMatchObject({ active: false, visible: false, mode: 'off' });
    expect(children[0].exited).toBe(true);
    expect(errors).toEqual([]);
  });

  it('disables capture and closes its child without waiting for a serial request', async () => {
    const { input, controller, children, key } = fixture();
    await input.toggle();
    let finish;
    controller.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    key(76, true);
    await Promise.resolve();
    // A quick key-up has already cleared held buttons, but its serial command
    // still sits behind key-down. Hiding must still send a neutral report.
    key(76, false);
    const hiding = input.hide();
    expect(input.getState()).toMatchObject({ active: false, visible: false });
    expect(children[0].enabled).toBe(false);
    await Promise.resolve();
    expect(children[0].exited).toBe(true);
    finish({});
    await hiding;
    expect(controller.call.mock.calls).toEqual([
      ['controller.key', { key: 'A', down: true }], ['controller.reset'],
    ]);
  });

  it('waits for readiness for concurrent activations, and treats early child exit as failure', async () => {
    const { input, children } = fixture({ autoReady: false });
    const first = input.setActive(true), second = input.setActive(true);
    expect(children[0].enabled).toBe(false);
    children[0].exit();
    await Promise.all([first, second]);
    expect(input.getState().active).toBe(false);
    expect(input.child).toBeNull();
  });

  it('keeps the final neutral report when deactivation is requested twice', async () => {
    const { input, controller, key } = fixture();
    await input.toggle();
    let finish;
    controller.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    key(76, true);
    await Promise.resolve();
    const first = input.hide(), second = input.setActive(false);
    finish({});
    await Promise.all([first, second]);
    expect(controller.call.mock.calls).toEqual([
      ['controller.key', { key: 'A', down: true }], ['controller.reset'],
    ]);
  });

  it('does not start a replacement hook if disconnected while reopening', async () => {
    const { input, children, connection, errors } = fixture();
    await input.toggle();
    const hiding = input.hide();
    const reopening = input.setActive(true);
    connection('failed');
    await Promise.all([hiding, reopening]);
    expect(children).toHaveLength(1);
    expect(input.getState()).toMatchObject({ active: false, visible: false });
    expect(errors).toEqual([]);
  });

  it('cannot reopen capture after close', async () => {
    const { input, controller, children } = fixture();
    await input.toggle();
    await input.close();
    controller.call.mockClear();
    // Closing the BrowserWindow calls hide again after input.close(). It must
    // not issue another reset while the controller runtime is shutting down.
    await input.hide();
    await input.close();
    expect(controller.call).not.toHaveBeenCalled();
    await input.toggle();
    expect(children).toHaveLength(1);
    expect(input.getState()).toMatchObject({ active: false, visible: false });
  });
});

it('publishes WASD, diagonal/opposing sticks and button highlights before serial completion', async () => {
  const { input, controller, key } = fixture();
  await input.toggle();
  key(87, true); key(65, true); key(76, true); key(39, true); key(85, true);
  expect(controller.call).not.toHaveBeenCalled();
  expect(input.getState().inputReport).toEqual({ ...neutral, buttons: 4, hat: 1, lx: 0, ly: 0, rx: 255 });
  key(83, true); key(68, true);
  expect(input.getState().inputReport).toMatchObject({ lx: 128, ly: 128 });
  for (const vk of [87, 65, 76, 39, 85, 83, 68]) key(vk, false);
  expect(input.getState().inputReport).toEqual(neutral);
  await input.setActive(false);
  expect(input.getState().inputReport).toBeNull();
});
