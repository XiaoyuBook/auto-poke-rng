// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ControllerOverlayApp } from './ControllerOverlayApp';

vi.mock('../useDevices', () => ({ useDevices: () => ({ controller: { status: 'connected' } }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fixture() {
  const api = {
    getState: vi.fn(async () => ({ visible: true, active: false, mode: 'standby', scale: 1 })),
    onState: vi.fn(() => () => {}), toggleActive: vi.fn(async () => {}),
    hide: vi.fn(async () => {}), moveBy: vi.fn(async () => {}), moveDrag: vi.fn(async () => {}), resetPosition: vi.fn(async () => {}),
  };
  Object.defineProperty(window, 'desktop', { configurable: true, value: { overlay: api } });
  // jsdom does not schedule animation frames by default.
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  render(<ControllerOverlayApp />);
  const overlay = screen.getByRole('application');
  Object.assign(overlay, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() });
  const pointer = (type: string, properties: Record<string, number> = {}) => {
    fireEvent(overlay, new window.PointerEvent(type, { bubbles: true, pointerId: 1, screenX: 100, screenY: 100, ...properties }));
  };
  return { api, overlay, pointer };
}

it.each([0, 2])('moves with button %s and never toggles or resets after dragging', button => {
  const { api, overlay, pointer } = fixture();
  pointer('pointerdown', { button });
  pointer('pointermove', { buttons: button === 0 ? 1 : 2, screenX: 112, screenY: 108 });
  pointer('pointermove', { buttons: button === 0 ? 1 : 2, screenX: 124, screenY: 116 });
  pointer('pointerup', { button, screenX: 130, screenY: 120 });
  expect(api.moveDrag).toHaveBeenCalledExactlyOnceWith(30, 20, expect.any(String));
  expect(api.toggleActive).not.toHaveBeenCalled();
  expect(api.resetPosition).not.toHaveBeenCalled();
  expect(overlay.releasePointerCapture).toHaveBeenCalledWith(1);
});

it('tolerates small click movement and preserves left toggle/right reset', () => {
  const { api, pointer } = fixture();
  for (const button of [0, 2]) {
    pointer('pointerdown', { button });
    pointer('pointermove', { buttons: button === 0 ? 1 : 2, screenX: 102 });
    pointer('pointerup', { button, screenX: 102 });
  }
  expect(api.toggleActive).toHaveBeenCalledOnce();
  expect(api.resetPosition).toHaveBeenCalledOnce();
  expect(api.moveDrag).not.toHaveBeenCalled();
});

it.each(['pointercancel', 'lostpointercapture', 'blur'])('recovers from %s without a phantom click or reset', interruption => {
  const { api, pointer } = fixture();
  pointer('pointerdown', { button: 2 });
  pointer('pointermove', { buttons: 2, screenX: 120 });
  if (interruption === 'blur') fireEvent(window, new Event('blur'));
  else pointer(interruption);
  pointer('pointerup', { button: 2 });
  expect(api.resetPosition).not.toHaveBeenCalled();
  expect(api.moveDrag).not.toHaveBeenCalled();
  pointer('pointerdown', { button: 0 });
  pointer('pointerup', { button: 0 });
  expect(api.toggleActive).toHaveBeenCalledOnce();
});

it('accepts additional mouse buttons during dragging and middle-click still closes', () => {
  const { api, overlay, pointer } = fixture();
  pointer('pointerdown', { button: 2 });
  pointer('pointermove', { buttons: 3, screenX: 120 });
  pointer('pointerup', { button: 2, screenX: 120 });
  expect(api.moveDrag).toHaveBeenCalledExactlyOnceWith(20, 0, expect.any(String));
  pointer('pointerdown', { button: 2 });
  fireEvent.mouseDown(overlay, { button: 1, buttons: 6 });
  expect(api.hide).not.toHaveBeenCalled();
  fireEvent.mouseUp(overlay, { button: 1, buttons: 2 });
  pointer('pointerup', { button: 2 });
  expect(api.hide).toHaveBeenCalledOnce();
  expect(api.resetPosition).not.toHaveBeenCalled();
});

it('has no close button and closes only after a complete middle click', () => {
  const { api, overlay } = fixture();
  expect(screen.queryByRole('button', { name: '关闭虚拟手柄' })).toBeNull();
  fireEvent.mouseUp(overlay, { button: 1 });
  expect(api.hide).not.toHaveBeenCalled();
  for (let cycle = 0; cycle < 3; cycle++) {
    fireEvent.mouseDown(overlay, { button: 1 });
    expect(api.hide).toHaveBeenCalledTimes(cycle);
    fireEvent.mouseUp(overlay, { button: 1 });
    expect(api.hide).toHaveBeenCalledTimes(cycle + 1);
  }
});

it('keeps relative movement compatible with an already running older preload', () => {
  const { api, pointer } = fixture();
  Reflect.deleteProperty(api, 'moveDrag');
  pointer('pointerdown', { button: 2 });
  pointer('pointermove', { buttons: 2, screenX: 112, screenY: 108 });
  vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](0);
  pointer('pointermove', { buttons: 2, screenX: 124, screenY: 116 });
  pointer('pointerup', { button: 2, screenX: 124, screenY: 116 });
  expect(api.moveBy.mock.calls).toEqual([[12, 8], [12, 8]]);
});
