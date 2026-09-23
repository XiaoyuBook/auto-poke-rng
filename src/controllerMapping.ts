export type ControllerButton =
  | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'
  | 'A' | 'B' | 'X' | 'Y' | 'L' | 'R' | 'ZL' | 'ZR'
  | 'PLUS' | 'MINUS' | 'CAPTURE' | 'HOME' | 'LCLICK' | 'RCLICK';

export interface ControllerMapping {
  label: string;
  button: ControllerButton | 'D_PAD';
  keyboard: string;
  note?: string;
}

/**
 * Keep the mapping in one place so the overlay, keyboard handler and mapping
 * dialog cannot silently drift apart. L/K/I/J follows the EasyCon desktop
 * project's defaults; the old lower-case face-button aliases remain valid.
 */
export const DEFAULT_CONTROLLER_MAPPINGS: ControllerMapping[] = [
  { label: 'A', button: 'A', keyboard: 'L', note: '兼容 A' },
  { label: 'B', button: 'B', keyboard: 'K', note: '兼容 B' },
  { label: 'X', button: 'X', keyboard: 'I', note: '兼容 X' },
  { label: 'Y', button: 'Y', keyboard: 'J', note: '兼容 Y' },
  { label: 'L', button: 'L', keyboard: 'G' },
  { label: 'R', button: 'R', keyboard: 'T' },
  { label: 'ZL', button: 'ZL', keyboard: 'F' },
  { label: 'ZR', button: 'ZR', keyboard: 'R' },
  { label: 'Plus', button: 'PLUS', keyboard: '+' , note: '兼容 Enter / =' },
  { label: 'Minus', button: 'MINUS', keyboard: '-' },
  { label: 'Capture', button: 'CAPTURE', keyboard: 'Z' },
  { label: 'Home', button: 'HOME', keyboard: 'C' },
  { label: 'LClick', button: 'LCLICK', keyboard: 'Q' },
  { label: 'RClick', button: 'RCLICK', keyboard: 'E' },
  { label: '方向键', button: 'D_PAD', keyboard: '↑ ↓ ← →', note: '虚拟手柄方向键' },
];

const aliases: Record<string, ControllerButton> = {
  arrowup: 'UP', arrowdown: 'DOWN', arrowleft: 'LEFT', arrowright: 'RIGHT',
  l: 'A', k: 'B', i: 'X', j: 'Y',
  a: 'A', b: 'B', x: 'X', y: 'Y',
  g: 'L', t: 'R', f: 'ZL', r: 'ZR',
  '+': 'PLUS', '=': 'PLUS', enter: 'PLUS',
  '-': 'MINUS', z: 'CAPTURE', c: 'HOME', q: 'LCLICK', e: 'RCLICK',
};

export function resolveKeyboardButton(key: string): ControllerButton | null {
  return aliases[key.toLowerCase()] || null;
}

export function formatKeyboardMapping(mapping: ControllerMapping) {
  return mapping.note ? `${mapping.keyboard}（${mapping.note}）` : mapping.keyboard;
}
