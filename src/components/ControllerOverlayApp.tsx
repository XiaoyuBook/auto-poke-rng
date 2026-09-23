import { useEffect, useRef, useState } from 'react';
import joyCon from '../assets/vpad/JoyCon.png';
import joyConL0 from '../assets/vpad/JoyCon_L_0.png';
import joyConL1 from '../assets/vpad/JoyCon_L_1.png';
import joyConR0 from '../assets/vpad/JoyCon_R_0.png';
import joyConR1 from '../assets/vpad/JoyCon_R_1.png';
import joyConZl0 from '../assets/vpad/JoyCon_ZL_0.png';
import joyConZl1 from '../assets/vpad/JoyCon_ZL_1.png';
import joyConZr0 from '../assets/vpad/JoyCon_ZR_0.png';
import joyConZr1 from '../assets/vpad/JoyCon_ZR_1.png';
import { useDevices } from '../useDevices';
import type { ControllerReport } from '../devices';
import type { ControllerOverlayState } from '../desktop';

const bit = { Y: 1, B: 2, A: 4, X: 8, L: 16, R: 32, ZL: 64, ZR: 128, MINUS: 256, PLUS: 512, LCLICK: 1024, RCLICK: 2048, HOME: 4096, CAPTURE: 8192 } as const;
const centerReport: ControllerReport = { buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 };

export function ControllerOverlayApp() {
  const { controller } = useDevices();
  const api = window.desktop?.overlay;
  const [state, setState] = useState<ControllerOverlayState>({ visible: true, active: false, mode: 'standby', scale: 1 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  useEffect(() => {
    if (!api) return;
    let alive = true;
    void api.getState().then(value => { if (alive) setState(value); }).catch(() => {});
    return api.onState(value => setState(value));
  }, [api]);
  useEffect(() => {
    const previous = document.body.style.background;
    document.body.style.background = 'transparent';
    return () => { document.body.style.background = previous; };
  }, []);
  const report = controller.status === 'connected' && controller.report ? controller.report : centerReport;
  const pressed = (name: keyof typeof bit) => Boolean(report.buttons & bit[name]);
  const hats: Record<number, string> = { 0: 'up', 1: 'up right', 2: 'right', 3: 'down right', 4: 'down', 5: 'down left', 6: 'left', 7: 'up left', 8: '' };
  const hat = hats[report.hat] || '';
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
  const stick = (side: 'left' | 'right', x: number, y: number, click: boolean) => {
    const active = side === 'left' ? pressed('LCLICK') : pressed('RCLICK');
    const moved = side === 'left' ? report.lx !== 128 || report.ly !== 128 : report.rx !== 128 || report.ry !== 128;
    return <div className={'overlay-stick ' + side + (active ? ' pressed' : '') + (moved ? ' moved' : '')}>
      <span className="overlay-stick-ring" /><span className="overlay-stick-knob" style={{ left: `${40 * ((x + 1) / 2)}%`, top: `${40 * ((y + 1) / 2)}%` }} />
      {click && <span className="overlay-stick-label" />}
    </div>;
  };
  return <main className={'controller-overlay ' + (state.active ? 'active' : 'standby')} role="application" aria-label="虚拟手柄状态浮窗"
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onContextMenu={event => event.preventDefault()} onClick={event => { if (event.button === 0) toggle(); }}>
    <img className="overlay-base" src={joyCon} alt="" draggable={false} />
    <img className="overlay-layer shoulder-l" src={pressed('L') ? joyConL1 : joyConL0} alt="" draggable={false} />
    <img className="overlay-layer shoulder-r" src={pressed('R') ? joyConR1 : joyConR0} alt="" draggable={false} />
    <img className="overlay-layer shoulder-zl" src={pressed('ZL') ? joyConZl1 : joyConZl0} alt="" draggable={false} />
    <img className="overlay-layer shoulder-zr" src={pressed('ZR') ? joyConZr1 : joyConZr0} alt="" draggable={false} />
    {stick('left', (report.lx - 128) / 127, (report.ly - 128) / 127, true)}
    {stick('right', (report.rx - 128) / 127, (report.ry - 128) / 127, true)}
    <div className="overlay-hat"><i className={hat.includes('up') ? 'pressed' : ''} /><i className={hat.includes('down') ? 'pressed' : ''} /><i className={hat.includes('left') ? 'pressed' : ''} /><i className={hat.includes('right') ? 'pressed' : ''} /></div>
    <div className="overlay-face"><i className={pressed('X') ? 'pressed' : ''} /><i className={pressed('Y') ? 'pressed' : ''} /><i className={pressed('A') ? 'pressed' : ''} /><i className={pressed('B') ? 'pressed' : ''} /></div>
    <div className="overlay-system"><i className={pressed('MINUS') ? 'pressed' : ''} /><i className={pressed('PLUS') ? 'pressed' : ''} /><i className={pressed('CAPTURE') ? 'pressed' : ''} /><i className={pressed('HOME') ? 'pressed' : ''} /></div>
    <div className="overlay-script-lights">{[0, 1, 2, 3].map(index => <i key={index} className={controller.running || controller.owned ? 'running' : state.active ? 'ready' : ''} />)}</div>
  </main>;
}
