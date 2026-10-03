import { useEffect, useRef, useState } from 'react';
import { useDevices } from '../useDevices';
import type { ControllerOverlayState } from '../desktop';
import { JoyConGraphic, NEUTRAL_REPORT } from './JoyConGraphic';

export function ControllerOverlayApp() {
  const { controller } = useDevices();
  const api = window.desktop?.overlay;
  const [state, setState] = useState<ControllerOverlayState>({ visible: true, active: false, mode: 'standby', scale: 1 });
  const drag = useRef<{ id: string; pointerId: number; button: number; x: number; y: number; sentX: number; sentY: number; moved: boolean } | null>(null);
  const movement = useRef<{ dx: number; dy: number; id: string } | null>(null);
  const frame = useRef<number | null>(null);
  const middlePressed = useRef(false);
  const flushMove = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const pending = movement.current;
    movement.current = null;
    const current = drag.current;
    if (!pending || !api || current?.id !== pending.id) return;
    if (pending.dx === current.sentX && pending.dy === current.sentY) return;
    // Vite can refresh this renderer before the running Electron preload is
    // restarted. Keep relative movement compatible with that older bridge.
    const request = api.moveDrag ? api.moveDrag(pending.dx, pending.dy, pending.id)
      : api.moveBy(pending.dx - current.sentX, pending.dy - current.sentY);
    current.sentX = pending.dx; current.sentY = pending.dy;
    void request.catch(() => {});
  };
  const cancelDrag = () => {
    middlePressed.current = false;
    drag.current = null;
    movement.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  useEffect(() => {
    if (!api) return;
    let alive = true, updated = false;
    const unsubscribe = api.onState(value => { updated = true; if (alive) setState(value); });
    void api.getState().then(value => { if (alive && !updated) setState(value); }).catch(() => {});
    return () => { alive = false; unsubscribe(); };
  }, [api]);
  useEffect(() => {
    const previous = document.body.style.background;
    document.body.style.background = 'transparent';
    window.addEventListener('blur', cancelDrag);
    return () => {
      document.body.style.background = previous;
      window.removeEventListener('blur', cancelDrag);
      cancelDrag();
    };
  }, []);
  useEffect(() => { if (!state.visible) cancelDrag(); }, [state.visible]);
  const report = controller.status !== 'connected' ? NEUTRAL_REPORT
    : state.active && !controller.running && !controller.owned && state.inputReport
      ? state.inputReport : controller.report || NEUTRAL_REPORT;
  const toggle = () => { if (api) void api.toggleActive().catch(() => {}); };
  const hide = () => { cancelDrag(); if (api) void api.hide().catch(() => {}); };
  const down = (event: React.PointerEvent) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    cancelDrag();
    drag.current = { id: crypto.randomUUID(), pointerId: event.pointerId, button: event.button, x: event.screenX, y: event.screenY, sentX: 0, sentY: 0, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId || !api) return;
    if (!(event.buttons & (current.button === 0 ? 1 : 2))) { cancelDrag(); return; }
    const dx = event.screenX - current.x, dy = event.screenY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < 4) return;
    current.moved = true;
    movement.current = { dx, dy, id: current.id };
    if (frame.current === null) frame.current = requestAnimationFrame(flushMove);
  };
  const up = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId || event.button !== current.button) return;
    const dx = event.screenX - current.x, dy = event.screenY - current.y;
    if (current.moved || Math.hypot(dx, dy) >= 4) {
      current.moved = true;
      movement.current = { dx, dy, id: current.id };
    }
    flushMove();
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!current.moved) {
      if (current.button === 0) toggle();
      else if (api) void api.resetPosition().catch(() => {});
    }
  };
  return <main className={'controller-overlay ' + (state.active ? 'active' : 'standby')} role="application" aria-label="虚拟手柄状态浮窗"
    title="左键单击：启用 / 待机 · 左键或右键拖动 · 右键单击复位 · 中键或 Ctrl + Esc 关闭"
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
    onMouseDown={event => { if (event.button === 1) { event.preventDefault(); cancelDrag(); middlePressed.current = true; } }}
    onMouseUp={event => { if (event.button === 1 && middlePressed.current) { event.preventDefault(); hide(); } }}
    onContextMenu={event => event.preventDefault()}>
    <JoyConGraphic report={report} running={controller.status === 'connected' && Boolean(controller.running || controller.owned)} />
  </main>;
}
