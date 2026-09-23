import { useId } from 'react';
import { keyDisplay, MAPPING_DEFINITIONS, type ControllerMapping } from '../controllerMapping';

// The diagram follows the Nintendo Switch Pro Controller's visual grammar:
// d-pad and face buttons sit high on the body, while both sticks sit low and
// mirror each other. The controls remain semantic HTML buttons inside the SVG
// so keyboard focus, labels, and click targets do not depend on a bitmap.
const positions: Record<string, [number, number, number?, number?]> = {
  ZL: [145, 51, 122, 35], L: [145, 91, 122, 32], ZR: [493, 51, 122, 35], R: [493, 91, 122, 32],
  Minus: [331, 151, 40, 32], Plus: [389, 151, 40, 32], Capture: [331, 203, 40, 32], Home: [389, 203, 40, 32],
  UpLeft: [120, 192, 30, 30], Up: [151, 192, 30, 30], UpRight: [182, 192, 30, 30],
  Left: [120, 223, 30, 30], Right: [182, 223, 30, 30],
  DownLeft: [120, 254, 30, 30], Down: [151, 254, 30, 30], DownRight: [182, 254, 30, 30],
  X: [598, 184, 42, 42], Y: [548, 224, 42, 42], A: [648, 224, 42, 42], B: [598, 264, 42, 42],
  LSUp: [218, 266], LSDown: [218, 378], LSLeft: [162, 322], LSRight: [274, 322], LClick: [218, 322],
  RSUp: [542, 266], RSDown: [542, 378], RSLeft: [486, 322], RSRight: [598, 322], RClick: [542, 322],
};

const legends: Record<string, string> = {
  Minus: '−', Plus: '+', Capture: '截图', Home: 'HOME', LClick: '按下', RClick: '按下',
  LSUp: '↑', LSDown: '↓', LSLeft: '←', LSRight: '→', RSUp: '↑', RSDown: '↓', RSLeft: '←', RSRight: '→',
};

export function MappingController({ mapping, selected, listening, onSelect, disabled }: {
  mapping: ControllerMapping; selected: string; listening: boolean; disabled: boolean; onSelect: (id: string) => void;
}) {
  const id = useId().replaceAll(':', '');
  return <svg className="mapping-controller" viewBox="0 0 760 500" role="group" aria-label="Nintendo Switch Pro 手柄按键布局">
    <defs>
      <linearGradient id={`${id}-shell`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="var(--mapping-shell-top)" /><stop offset="1" stopColor="var(--mapping-shell-bottom)" />
      </linearGradient>
      <radialGradient id={`${id}-well`} cx="42%" cy="35%">
        <stop offset="0" stopColor="var(--mapping-well-center)" /><stop offset="1" stopColor="var(--mapping-well-edge)" />
      </radialGradient>
    </defs>
    <g aria-hidden="true">
      <path className="mapping-shell-shadow" d="M174 104 C135 111 113 142 102 192 L67 373 C58 419 76 458 112 463 C146 468 173 437 187 397 L207 337 C213 318 229 307 249 307 H511 C531 307 547 318 553 337 L573 397 C587 437 614 468 648 463 C684 458 702 419 693 373 L658 192 C647 142 625 111 586 104 L532 97 C508 94 494 85 479 71 C475 67 469 65 462 65 H298 C291 65 285 67 281 71 C266 85 252 94 228 97 Z" />
      <path className="mapping-shell" fill={`url(#${id}-shell)`} d="M174 104 C135 111 113 142 102 192 L67 373 C58 419 76 458 112 463 C146 468 173 437 187 397 L207 337 C213 318 229 307 249 307 H511 C531 307 547 318 553 337 L573 397 C587 437 614 468 648 463 C684 458 702 419 693 373 L658 192 C647 142 625 111 586 104 L532 97 C508 94 494 85 479 71 C475 67 469 65 462 65 H298 C291 65 285 67 281 71 C266 85 252 94 228 97 Z" />
      <path className="mapping-shell-seam" d="M95 397 C111 350 115 286 130 235 M665 397 C649 350 645 286 630 235" />
      <path className="mapping-shoulder-link" d="M173 105 V73 C173 63 181 58 191 58 H269 M587 105 V73 C587 63 579 58 569 58 H491" />

      <circle className="mapping-well" cx="218" cy="332" r="60" fill={`url(#${id}-well)`} />
      <circle className="mapping-well-inner" cx="218" cy="332" r="36" />
      <circle className="mapping-well" cx="542" cy="332" r="60" fill={`url(#${id}-well)`} />
      <circle className="mapping-well-inner" cx="542" cy="332" r="36" />
      <circle className="mapping-face-well" cx="598" cy="244" r="72" />
      <path className="mapping-dpad-well" d="M145 188 H176 V211 H199 V242 H176 V265 H145 V242 H122 V211 H145 Z" />
      <path className="mapping-center-mark" d="M365 270 H395" />
    </g>
    {MAPPING_DEFINITIONS.map(definition => {
      const [x, y, width = 44, height = 44] = positions[definition.id];
      const code = mapping[definition.id];
      return <foreignObject key={definition.id} x={x} y={y} width={width} height={height}>
        <button type="button" disabled={disabled} data-mapping-id={definition.id} data-group={definition.group}
          className={'mapping-key-button' + (definition.group === 'dpad' ? ' mapping-dpad-segment' : '') + (selected === definition.id ? ' selected' : '') + (!code ? ' unbound' : '') + (selected === definition.id && listening ? ' listening' : '')}
          aria-label={`${definition.label}：${keyDisplay(code)}`} aria-pressed={selected === definition.id}
          title={`${definition.label} → ${keyDisplay(code)} · 点击修改`} onClick={() => onSelect(definition.id)}>
          <span className="mapping-control-name">{legends[definition.id] || definition.label}</span>
          <span className="mapping-key-value">{code ? keyDisplay(code) : definition.group === 'dpad' ? '' : '—'}</span>
        </button>
      </foreignObject>;
    })}
  </svg>;
}
