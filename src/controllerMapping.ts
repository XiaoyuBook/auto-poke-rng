export type ControllerButton =
  | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'
  | 'UP_LEFT' | 'UP_RIGHT' | 'DOWN_LEFT' | 'DOWN_RIGHT'
  | 'A' | 'B' | 'X' | 'Y' | 'L' | 'R' | 'ZL' | 'ZR'
  | 'PLUS' | 'MINUS' | 'CAPTURE' | 'HOME' | 'LCLICK' | 'RCLICK';

export type StickSide = 'LS' | 'RS';
export type StickDirection = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
export type MappingAction =
  | { kind: 'button'; key: ControllerButton }
  | { kind: 'stick'; side: StickSide; direction: StickDirection };

export interface MappingDefinition {
  id: string;
  label: string;
  group: 'shoulder' | 'system' | 'left-stick' | 'dpad' | 'right-stick' | 'face';
  action: MappingAction;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ControllerMapping = Record<string, string | null>;

// Supported by controller-input.cjs's Windows key translation. Modifier keys
// and combinations are deliberately excluded from the single-key editor.
export function isSupportedMappingCode(code: string): boolean {
  return /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-9]|2[0-4]))$/.test(code)
    || ['Enter', 'Space', 'Tab', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete', 'CapsLock', 'NumLock', 'ScrollLock',
      'Equal', 'Minus', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Backquote',
      'Comma', 'Period', 'Slash', 'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'ContextMenu'].includes(code);
}

// Coordinates mirror the original EasyCon mapping dialog's 999 × 610 design.
export const MAPPING_DEFINITIONS: MappingDefinition[] = [
  { id: 'ZL', label: 'ZL', group: 'shoulder', action: { kind: 'button', key: 'ZL' }, x: 280, y: 134, width: 62, height: 41 },
  { id: 'L', label: 'L', group: 'shoulder', action: { kind: 'button', key: 'L' }, x: 280, y: 185, width: 62, height: 41 },
  { id: 'ZR', label: 'ZR', group: 'shoulder', action: { kind: 'button', key: 'ZR' }, x: 643, y: 134, width: 62, height: 41 },
  { id: 'R', label: 'R', group: 'shoulder', action: { kind: 'button', key: 'R' }, x: 643, y: 185, width: 62, height: 41 },
  { id: 'Minus', label: 'Minus', group: 'system', action: { kind: 'button', key: 'MINUS' }, x: 365, y: 241, width: 62, height: 41 },
  { id: 'Capture', label: 'Capture', group: 'system', action: { kind: 'button', key: 'CAPTURE' }, x: 417, y: 292, width: 62, height: 41 },
  { id: 'Home', label: 'Home', group: 'system', action: { kind: 'button', key: 'HOME' }, x: 522, y: 292, width: 62, height: 41 },
  { id: 'Plus', label: 'Plus', group: 'system', action: { kind: 'button', key: 'PLUS' }, x: 571, y: 239, width: 62, height: 41 },
  { id: 'LSUp', label: 'LS ↑', group: 'left-stick', action: { kind: 'stick', side: 'LS', direction: 'UP' }, x: 218, y: 239, width: 62, height: 41 },
  { id: 'LSDown', label: 'LS ↓', group: 'left-stick', action: { kind: 'stick', side: 'LS', direction: 'DOWN' }, x: 218, y: 340, width: 62, height: 41 },
  { id: 'LSLeft', label: 'LS ←', group: 'left-stick', action: { kind: 'stick', side: 'LS', direction: 'LEFT' }, x: 146, y: 292, width: 62, height: 41 },
  { id: 'LSRight', label: 'LS →', group: 'left-stick', action: { kind: 'stick', side: 'LS', direction: 'RIGHT' }, x: 290, y: 292, width: 62, height: 41 },
  { id: 'LClick', label: 'LClick', group: 'left-stick', action: { kind: 'button', key: 'LCLICK' }, x: 218, y: 292, width: 62, height: 41 },
  { id: 'Up', label: '↑', group: 'dpad', action: { kind: 'button', key: 'UP' }, x: 352, y: 358, width: 49, height: 41 },
  { id: 'Down', label: '↓', group: 'dpad', action: { kind: 'button', key: 'DOWN' }, x: 352, y: 439, width: 49, height: 41 },
  { id: 'Left', label: '←', group: 'dpad', action: { kind: 'button', key: 'LEFT' }, x: 303, y: 395, width: 49, height: 41 },
  { id: 'Right', label: '→', group: 'dpad', action: { kind: 'button', key: 'RIGHT' }, x: 402, y: 395, width: 49, height: 41 },
  { id: 'UpLeft', label: '↖', group: 'dpad', action: { kind: 'button', key: 'UP_LEFT' }, x: 303, y: 358, width: 49, height: 41 },
  { id: 'UpRight', label: '↗', group: 'dpad', action: { kind: 'button', key: 'UP_RIGHT' }, x: 402, y: 358, width: 49, height: 41 },
  { id: 'DownLeft', label: '↙', group: 'dpad', action: { kind: 'button', key: 'DOWN_LEFT' }, x: 303, y: 439, width: 49, height: 41 },
  { id: 'DownRight', label: '↘', group: 'dpad', action: { kind: 'button', key: 'DOWN_RIGHT' }, x: 402, y: 439, width: 49, height: 41 },
  { id: 'RSUp', label: 'RS ↑', group: 'right-stick', action: { kind: 'stick', side: 'RS', direction: 'UP' }, x: 571, y: 357, width: 62, height: 41 },
  { id: 'RSDown', label: 'RS ↓', group: 'right-stick', action: { kind: 'stick', side: 'RS', direction: 'DOWN' }, x: 571, y: 459, width: 62, height: 41 },
  { id: 'RSLeft', label: 'RS ←', group: 'right-stick', action: { kind: 'stick', side: 'RS', direction: 'LEFT' }, x: 499, y: 409, width: 62, height: 41 },
  { id: 'RSRight', label: 'RS →', group: 'right-stick', action: { kind: 'stick', side: 'RS', direction: 'RIGHT' }, x: 643, y: 409, width: 62, height: 41 },
  { id: 'RClick', label: 'RClick', group: 'right-stick', action: { kind: 'button', key: 'RCLICK' }, x: 571, y: 409, width: 62, height: 41 },
  { id: 'X', label: 'X', group: 'face', action: { kind: 'button', key: 'X' }, x: 691, y: 250, width: 62, height: 41 },
  { id: 'Y', label: 'Y', group: 'face', action: { kind: 'button', key: 'Y' }, x: 633, y: 292, width: 62, height: 41 },
  { id: 'A', label: 'A', group: 'face', action: { kind: 'button', key: 'A' }, x: 758, y: 292, width: 62, height: 41 },
  { id: 'B', label: 'B', group: 'face', action: { kind: 'button', key: 'B' }, x: 691, y: 340, width: 62, height: 41 },
];

export const DEFAULT_CONTROLLER_MAPPING: ControllerMapping = {
  A: 'KeyL', B: 'KeyK', X: 'KeyI', Y: 'KeyJ',
  L: 'KeyG', R: 'KeyT', ZL: 'KeyF', ZR: 'KeyR',
  Plus: 'Equal', Minus: 'Minus', Capture: 'KeyZ', Home: 'KeyC',
  LClick: 'KeyQ', RClick: 'KeyE',
  Up: null, Down: null, Left: null, Right: null,
  UpLeft: null, DownLeft: null, UpRight: null, DownRight: null,
  LSUp: 'KeyW', LSDown: 'KeyS', LSLeft: 'KeyA', LSRight: 'KeyD',
  RSUp: 'ArrowUp', RSDown: 'ArrowDown', RSLeft: 'ArrowLeft', RSRight: 'ArrowRight',
};

const STORAGE_KEY = 'auto-poke-rng:controller-mapping';
export function loadControllerMapping(storage: Storage = localStorage): ControllerMapping {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_CONTROLLER_MAPPING };
    const result = { ...DEFAULT_CONTROLLER_MAPPING };
    for (const definition of MAPPING_DEFINITIONS) {
      const value = (parsed as Record<string, unknown>)[definition.id];
      if (value === null || typeof value === 'string') result[definition.id] = value;
    }
    return result;
  } catch {
    return { ...DEFAULT_CONTROLLER_MAPPING };
  }
}

export function saveControllerMapping(mapping: ControllerMapping, storage: Storage = localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(mapping));
}

export function mappingWithBinding(mapping: ControllerMapping, id: string, code: string | null): ControllerMapping {
  const next = { ...mapping };
  for (const definition of MAPPING_DEFINITIONS) {
    if (definition.id !== id && code && next[definition.id] === code) next[definition.id] = null;
  }
  next[id] = code;
  return next;
}

export function actionForMappingId(id: string): MappingAction | null {
  return MAPPING_DEFINITIONS.find(definition => definition.id === id)?.action || null;
}

export function keyDisplay(code: string | null | undefined): string {
  if (!code) return '未绑定';
  const names: Record<string, string> = {
    Equal: '+', Minus: '-', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Space: 'Space', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: 'Backspace',
    ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
    AltLeft: 'L Alt', AltRight: 'R Alt', MetaLeft: 'L Win', MetaRight: 'R Win',
  };
  if (names[code]) return names[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function mappingToActions(mapping: ControllerMapping): Record<string, MappingAction> {
  const actions: Record<string, MappingAction> = {};
  for (const definition of MAPPING_DEFINITIONS) if (mapping[definition.id]) actions[definition.id] = definition.action;
  return actions;
}

export const DEFAULT_CONTROLLER_MAPPINGS = MAPPING_DEFINITIONS.map(definition => ({
  label: definition.label,
  button: definition.action.kind === 'button' ? definition.action.key : definition.id,
  keyboard: keyDisplay(DEFAULT_CONTROLLER_MAPPING[definition.id]),
  note: DEFAULT_CONTROLLER_MAPPING[definition.id] ? undefined : '未绑定',
}));

export function formatKeyboardMapping(mapping: { keyboard: string; note?: string }) {
  return mapping.note ? `${mapping.keyboard}（${mapping.note}）` : mapping.keyboard;
}

export function resolveKeyboardButton(key: string, mapping: ControllerMapping = DEFAULT_CONTROLLER_MAPPING): ControllerButton | null {
  const codeByKey: Record<string, string> = { l: 'KeyL', k: 'KeyK', i: 'KeyI', j: 'KeyJ', g: 'KeyG', t: 'KeyT', f: 'KeyF', r: 'KeyR', z: 'KeyZ', c: 'KeyC', q: 'KeyQ', e: 'KeyE', '+': 'Equal', '=': 'Equal', '-': 'Minus', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight' };
  const normalized = key.toLowerCase();
  const code = codeByKey[normalized] || (/^[a-z]$/.test(normalized) ? `Key${normalized.toUpperCase()}` : /^[0-9]$/.test(normalized) ? `Digit${normalized}` : undefined);
  if (!code) return null;
  const id = Object.keys(mapping).find(item => mapping[item] === code);
  const action = id ? actionForMappingId(id) : null;
  return action?.kind === 'button' ? action.key : null;
}

export { STORAGE_KEY as CONTROLLER_MAPPING_STORAGE_KEY };
