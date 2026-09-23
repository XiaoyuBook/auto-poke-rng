import { useId } from 'react';
import joyCon from '../assets/vpad/JoyCon-transparent.png';
import joyConL0 from '../assets/vpad/JoyCon_L_0.png';
import joyConL1 from '../assets/vpad/JoyCon_L_1.png';
import joyConR0 from '../assets/vpad/JoyCon_R_0.png';
import joyConR1 from '../assets/vpad/JoyCon_R_1.png';
import joyConZl0 from '../assets/vpad/JoyCon_ZL_0.png';
import joyConZl1 from '../assets/vpad/JoyCon_ZL_1.png';
import joyConZr0 from '../assets/vpad/JoyCon_ZR_0.png';
import joyConZr1 from '../assets/vpad/JoyCon_ZR_1.png';
import type { ControllerReport } from '../devices';

export const NEUTRAL_REPORT: ControllerReport = { buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 };
const bit = { Y: 1, B: 2, A: 4, X: 8, L: 16, R: 32, ZL: 64, ZR: 128, MINUS: 256, PLUS: 512, LCLICK: 1024, RCLICK: 2048, HOME: 4096, CAPTURE: 8192 } as const;
// SwitchHat is an ordinal (0..7 clockwise, 8 neutral), not DirectionKey's bitmask.
const hats = ['up', 'up right', 'right', 'down right', 'down', 'down left', 'left', 'up left', ''] as const;

// Port of auto-bdsp-rng/controller_overlay.py's 100 × 100 drawing coordinates.
// SVG keeps geometry and outlines in one coordinate system at every DPI/size.
export function JoyConGraphic({ report, running = false }: { report: ControllerReport; running?: boolean }) {
  const id = useId().replaceAll(':', '');
  const surface = `url(#${id}-surface)`, highlight = `url(#${id}-highlight)`;
  const pressed = (name: keyof typeof bit) => Boolean(report.buttons & bit[name]);
  const hat = hats[report.hat] || '';
  const stroke = '#101318';
  // Center 128 must be exactly zero; each half of the byte range has a different length.
  const offset = (value: number) => value <= 128 ? (value - 128) / 128 * 5 : (value - 128) / 127 * 5;
  const stick = (side: 'left' | 'right', x0: number, y0: number, x: number, y: number, click: boolean) => {
    const moved = x !== 128 || y !== 128;
    const cx = x0 + 12.5, cy = y0 + 12.5;
    return <g data-stick={side} data-moved={moved} data-pressed={click}>
      <circle data-part="ring" cx={cx} cy={cy} r={10.5} fill={moved ? '#42e994b8' : '#11151d50'} stroke={stroke} strokeWidth={0.8} />
      <g transform={`translate(${offset(x)} ${offset(y)})`}>
        <circle data-part="knob" cx={cx} cy={cy} r={7.5} fill={click ? highlight : surface} stroke={stroke} strokeWidth={0.9} />
        <circle cx={cx} cy={cy} r={6} fill="none" stroke={click ? '#b7ffda' : '#b4bec8'} strokeOpacity={0.24} strokeWidth={0.6} />
      </g>
    </g>;
  };

  return <svg className="joycon-graphic" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="手柄实时状态">
    <defs>
      <linearGradient id={`${id}-surface`} x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0" stopColor="#555d68" /><stop offset="1" stopColor="#30353e" />
      </linearGradient>
      <linearGradient id={`${id}-highlight`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#8bffc1" /><stop offset="1" stopColor="#32de88" />
      </linearGradient>
    </defs>
    <image href={joyCon} x="0" y="0" width="100" height="100" />
    <g className="joycon-lights" data-running={running} stroke={stroke} strokeWidth={0.7}>
      {[0, 1, 2, 3].map(index => <rect key={index} className="joycon-light" x={47} y={32 + 10 * index} width={5} height={5} rx={0.4} fill={running ? '#ffffff' : '#00000032'} />)}
    </g>
    {stick('left', 11, 21, report.lx, report.ly, pressed('LCLICK'))}
    {stick('right', 63, 52, report.rx, report.ry, pressed('RCLICK'))}
    <g stroke={stroke} strokeWidth={0.8}>
      {([['up', 21, 55], ['down', 21, 67], ['left', 15, 61], ['right', 27, 61]] as const).map(([direction, x, y]) =>
        <rect key={direction} data-control={`hat-${direction}`} data-pressed={hat.includes(direction)} x={x} y={y} width={6} height={6} rx={1.6} fill={hat.includes(direction) ? highlight : surface} />)}
    </g>
    {([['ZL', joyConZl0, joyConZl1], ['ZR', joyConZr0, joyConZr1], ['L', joyConL0, joyConL1], ['R', joyConR0, joyConR1]] as const).map(([name, idle, down]) =>
      <image key={name} data-control={name} data-pressed={pressed(name)} href={pressed(name) ? down : idle} x="0" y="0" width="100" height="100" />)}
    <g stroke={stroke} strokeWidth={0.8}>
      {([['A', 79, 29], ['B', 71, 37], ['X', 71, 21], ['Y', 63, 29]] as const).map(([name, x, y]) =>
        <circle key={name} data-control={name} data-pressed={pressed(name)} cx={x + 4.5} cy={y + 4.5} r={4.5} fill={pressed(name) ? highlight : surface} />)}
      {([['MINUS', 29, 12], ['PLUS', 65, 12], ['CAPTURE', 27, 82], ['HOME', 67, 82]] as const).map(([name, x, y]) =>
        <rect key={name} data-control={name} data-pressed={pressed(name)} x={x} y={y} width={5} height={5} rx={1} fill={pressed(name) ? highlight : surface} />)}
    </g>
  </svg>;
}
