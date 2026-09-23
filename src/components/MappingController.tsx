import bgUrl from '../assets/controller_bg_dark.png';
import { keyDisplay, MAPPING_DEFINITIONS, type ControllerMapping } from '../controllerMapping';

// Keep the same 999 × 610 coordinate system as auto-bdsp-rng. The controller
// art is intentionally quiet; keyboard bindings sit around the controls as
// small cards, matching the original mapping window's visual language.
export function MappingController({ mapping, selected, listening, onSelect, disabled }: {
  mapping: ControllerMapping; selected: string; listening: boolean; disabled: boolean; onSelect: (id: string) => void;
}) {
  return <div className="mapping-controller" role="group" aria-label="手柄按键布局">
    <div className="mapping-controller-canvas" style={{ backgroundImage: `url(${bgUrl})` }}>
      {MAPPING_DEFINITIONS.map(definition => {
        const code = mapping[definition.id];
        const active = selected === definition.id;
        return <button type="button" key={definition.id} disabled={disabled} data-mapping-id={definition.id}
          className={'mapping-key-button' + (active ? ' selected' : '') + (listening && active ? ' listening' : '') + (!code ? ' unbound' : '')}
          style={{
            left: `${(definition.x + definition.width / 2) / 999 * 100}%`,
            top: `${(definition.y + definition.height / 2) / 610 * 100}%`,
            width: `${definition.width / 999 * 100}%`,
            height: `${definition.height / 610 * 100}%`,
          }}
          aria-label={`${definition.label}：${keyDisplay(code)}`} aria-pressed={active}
          title={`${definition.label} → ${keyDisplay(code)} · 点击修改`} onClick={() => onSelect(definition.id)}>
          <span>{code ? keyDisplay(code) : ''}</span>
        </button>;
      })}
    </div>
  </div>;
}
