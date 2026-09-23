import { useEffect, useRef, useState } from 'react';
import { useDevices } from '../useDevices';
import type { ControllerOverlayState } from '../desktop';
import { JoyConGraphic, NEUTRAL_REPORT } from './JoyConGraphic';

export function ControllerOverlayApp() {
  const { controller } = useDevices();
  const api = window.desktop?.overlay;
  const [state, setState] = useState<ControllerOverlayState>({ visible: true, active: false, mode: 'standby', scale: 1 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
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
    return () => { document.body.style.background = previous; };
  }, []);
  const report = controller.status === 'connected' && controller.report ? controller.report : NEUTRAL_REPORT;
  const toggle = () => { if (api) void api.toggleActive(); };
  const hide = () => { if (api) void api.hide(); };
  const down = (event: React.PointerEvent) => {
    if (event.button === 1) { event.preventDefault(); hide(); return; }
    if (event.button !== 2) return;
    event.preventDefault();
    drag.current = { x: event.screenX, y: event.screenY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current || event.buttons !== 2 || !api) return;
    const dx = event.screenX - current.x, dy = event.screenY - current.y;
    if (!dx && !dy) return;
    current.moved = true; current.x = event.screenX; current.y = event.screenY;
    void api.moveBy(dx, dy);
  };
  const up = (event: React.PointerEvent) => {
    if (event.button !== 2) return;
    const current = drag.current;
    drag.current = null;
    if (!current?.moved && api) void api.resetPosition();
  };
  return <main className={'controller-overlay ' + (state.active ? 'active' : 'standby')} role="application" aria-label="虚拟手柄状态浮窗"
    title="左键：启用 / 待机 · 右键拖动 · 右键单击复位 · 中键关闭"
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onContextMenu={event => event.preventDefault()} onClick={event => { if (event.button === 0) toggle(); }}>
    <JoyConGraphic report={report} running={controller.status === 'connected' && Boolean(controller.running || controller.owned)} />
  </main>;
}
