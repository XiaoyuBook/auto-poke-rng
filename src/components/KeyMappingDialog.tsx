import { useEffect, useMemo, useState } from 'react';
import { Check, RotateCcw, Trash2, X } from 'lucide-react';
import bgUrl from '../assets/controller_bg.png';
import {
  DEFAULT_CONTROLLER_MAPPING,
  MAPPING_DEFINITIONS,
  keyDisplay,
  loadControllerMapping,
  mappingWithBinding,
  saveControllerMapping,
  type ControllerMapping,
} from '../controllerMapping';

interface Props {
  close: () => void;
  onSaved: (mapping: ControllerMapping) => void;
}

export function KeyMappingDialog({ close, onSaved }: Props) {
  const [mapping, setMapping] = useState<ControllerMapping>(() => loadControllerMapping());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState('选择手柄按键后，按下新的键盘按键。');
  const [dirty, setDirty] = useState(false);
  const active = useMemo(() => MAPPING_DEFINITIONS.find(item => item.id === activeId), [activeId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !activeId) {
        event.preventDefault();
        close();
        return;
      }
      if (!activeId || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      const code = event.code || null;
      const next = mappingWithBinding(mapping, activeId, event.key === 'Escape' ? null : code);
      setMapping(next);
      setDirty(true);
      setActiveId(null);
      setNotice(event.key === 'Escape' ? '已删除当前映射。' : `${active?.label || activeId} 已绑定为 ${keyDisplay(code)}。`);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [active, activeId, close, mapping]);

  const select = (id: string) => {
    setActiveId(id);
    const definition = MAPPING_DEFINITIONS.find(item => item.id === id);
    setNotice(`正在设置 ${definition?.label || id}，请按下新的键盘按键。`);
  };
  const restore = () => {
    setMapping({ ...DEFAULT_CONTROLLER_MAPPING });
    setActiveId(null);
    setDirty(true);
    setNotice('已恢复原版默认映射，点击“确定”后保存。');
  };
  const remove = () => {
    if (!activeId) return;
    setMapping(current => ({ ...current, [activeId]: null }));
    setActiveId(null);
    setDirty(true);
    setNotice('已删除当前映射，点击“确定”后保存。');
  };
  const confirm = () => {
    saveControllerMapping(mapping);
    onSaved(mapping);
    close();
  };

  return <section className="key-mapping-dialog" role="dialog" aria-label="按键设置" aria-modal="true">
    <header className="key-mapping-header">
      <h2>按键设置</h2>
      <button className="icon-button" aria-label="关闭按键设置" title="关闭" onClick={close}><X size={16} /></button>
    </header>
    <div className="key-mapping-content">
      <div className="mapping-diagram" style={{ backgroundImage: `url(${bgUrl})` }}>
        {MAPPING_DEFINITIONS.map(definition => {
          const selected = activeId === definition.id;
          return <button key={definition.id} className={'mapping-key-button ' + (selected ? 'selected' : '') + (mapping[definition.id] ? '' : ' unbound')}
            style={{ left: `${(definition.x + definition.width / 2) / 999 * 100}%`, top: `${(definition.y + definition.height / 2) / 610 * 100}%`, width: `${definition.width / 999 * 100}%`, height: `${definition.height / 610 * 100}%` }}
            aria-label={`${definition.label}：${keyDisplay(mapping[definition.id])}`} aria-pressed={selected} onClick={() => select(definition.id)}>
            <span>{keyDisplay(mapping[definition.id])}</span>
          </button>;
        })}
      </div>
      <div className="mapping-hint-row">
        <span className={activeId ? 'active' : ''}>{notice}</span>
        <button className="text-button mapping-delete" disabled={!activeId || !mapping[activeId]} onClick={remove}><Trash2 size={13} />删除映射</button>
      </div>
    </div>
    <footer className="key-mapping-footer">
      <button className="button mapping-reset" onClick={restore}><RotateCcw size={14} />恢复默认</button>
      <div className="key-mapping-actions"><button className="button" onClick={close}>取消</button><button className="button primary" onClick={confirm}><Check size={14} />确定</button></div>
    </footer>
    {dirty && <span className="mapping-dirty-indicator" aria-label="有未保存映射">未保存</span>}
  </section>;
}
