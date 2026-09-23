import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight, Check, Keyboard, RotateCcw, Trash2, X } from 'lucide-react';
import { MappingController } from './MappingController';
import {
  DEFAULT_CONTROLLER_MAPPING, MAPPING_DEFINITIONS, keyDisplay, loadControllerMapping,
  mappingWithBinding, saveControllerMapping, isSupportedMappingCode, type ControllerMapping,
} from '../controllerMapping';

const groupNames = { shoulder: '肩键', system: '功能键', 'left-stick': '左摇杆', dpad: '十字键', 'right-stick': '右摇杆', face: '面键' };
const names: Record<string, string> = {
  Minus: 'Minus −', Plus: 'Plus +', Capture: '截图键', Home: 'HOME', LClick: '左摇杆按下', RClick: '右摇杆按下',
  LSUp: '左摇杆 ↑', LSDown: '左摇杆 ↓', LSLeft: '左摇杆 ←', LSRight: '左摇杆 →',
  RSUp: '右摇杆 ↑', RSDown: '右摇杆 ↓', RSLeft: '右摇杆 ←', RSRight: '右摇杆 →',
};

export function KeyMappingDialog({ close, onSaved }: {
  close: () => void; onSaved: (mapping: ControllerMapping) => void | Promise<unknown>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [initial] = useState(loadControllerMapping);
  const [mapping, setMapping] = useState<ControllerMapping>(initial);
  const [selected, setSelected] = useState('A');
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState('点击一个控件，即可修改它的键盘映射。');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const swallowedKey = useRef('');
  const savingRef = useRef(false);
  const active = MAPPING_DEFINITIONS.find(item => item.id === selected)!;
  const name = names[selected] || active.label;
  const changes = MAPPING_DEFINITIONS.filter(item => mapping[item.id] !== initial[item.id]).length;
  const bound = MAPPING_DEFINITIONS.filter(item => mapping[item.id]).length;

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  const select = (id: string) => {
    setSelected(id); setListening(true); setError('');
    setNotice('等待键盘输入 · Esc 清除这个控件的绑定');
  };
  const remove = () => {
    setMapping(current => ({ ...current, [selected]: null }));
    setListening(false); setError(''); setNotice(`${name} 已取消绑定。`);
  };
  const keyDown = (event: KeyboardEvent) => {
    if (!listening || savingRef.current) return;
    event.preventDefault(); event.stopPropagation();
    swallowedKey.current = event.code;
    if (event.repeat || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { remove(); return; }
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || /^(Control|Shift|Alt|Meta)/.test(event.code)) {
      setNotice('请单独按一个键，无需按住 Ctrl、Alt 或 Shift。'); return;
    }
    // Enter on the keypad and the main keyboard share a Windows virtual key.
    const code = event.code === 'NumpadEnter' ? 'Enter' : event.code;
    if (!isSupportedMappingCode(code)) { setNotice('暂不支持这个按键，请换一个键。'); return; }
    const previous = MAPPING_DEFINITIONS.filter(item => item.id !== selected && mapping[item.id] === code);
    setMapping(current => mappingWithBinding(current, selected, code));
    setListening(false); setError('');
    setNotice(previous.length
      ? `${keyDisplay(code)} 已改绑到 ${name}；${previous.map(item => names[item.id] || item.label).join('、')} 已解除绑定。`
      : `${name} 已绑定 ${keyDisplay(code)}。`);
  };
  const confirm = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setListening(false); setError('');
    try {
      // Persist before applying, and restore the saved mapping if IPC fails.
      saveControllerMapping(mapping);
      try { await onSaved(mapping); }
      catch (cause) { saveControllerMapping(initial); throw cause; }
      close();
    } catch (cause) { setError('保存失败：' + (cause instanceof Error ? cause.message : String(cause))); }
    finally { savingRef.current = false; setSaving(false); }
  };

  return <dialog ref={dialog} className="key-mapping-dialog" aria-label="按键设置"
    onCancel={event => { event.preventDefault(); if (savingRef.current) return; if (listening) remove(); else close(); }}
    onKeyDownCapture={keyDown}
    onKeyUpCapture={event => { if (swallowedKey.current === event.code) { event.preventDefault(); event.stopPropagation(); swallowedKey.current = ''; } }}>
    <header className="key-mapping-header">
      <div className="mapping-title-icon"><Keyboard size={20} /></div>
      <div><h2>按键映射</h2><p>选择手柄控件，按下一个键完成绑定</p></div>
      <span className="mapping-scope">全局映射</span>
      <button className="icon-button" disabled={saving} aria-label="关闭按键设置" onClick={close}><X size={17} /></button>
    </header>
    <div className="key-mapping-content">
      <section className="mapping-board" aria-label="图形化按键映射">
        <div className="mapping-board-heading"><span>Switch Pro 手柄布局</span><span><strong>{bound}</strong> / 30 已绑定</span></div>
        <MappingController mapping={mapping} selected={selected} listening={listening} onSelect={select} disabled={saving} />
        <div className="mapping-board-caption"><span>上方为手柄按键 · 下方为键盘键</span><span><i /> 未绑定</span></div>
      </section>
      <aside className="mapping-inspector" aria-label="当前控件详情">
        <div className="mapping-section-label">{groupNames[active.group]}</div>
        <h3>{name}</h3>
        <p className="mapping-inspector-caption">{listening ? '正在等待你的键盘输入' : '点击图中的控件即可重新绑定'}</p>
        <button className={'mapping-binding-card' + (listening ? ' listening' : '')} disabled={saving} onClick={() => select(selected)} aria-label={`重新绑定 ${name}`}>
          <span className="mapping-binding-label"><Keyboard size={14} />键盘按键</span>
          <kbd>{listening ? '…' : keyDisplay(mapping[selected])}</kbd>
          <span>{listening ? '请按下一个键' : '点击修改'}<ArrowRight size={13} /></span>
        </button>
        <dl className="mapping-default"><dt>默认键位</dt><dd>{keyDisplay(DEFAULT_CONTROLLER_MAPPING[selected])}</dd></dl>
        <div className="mapping-inspector-actions">
          <button className="button" disabled={saving || !mapping[selected]} onClick={remove}><Trash2 size={13} />删除映射</button>
          <button className="text-button" disabled={saving || mapping[selected] === DEFAULT_CONTROLLER_MAPPING[selected]} onClick={() => {
            setMapping(current => mappingWithBinding(current, selected, DEFAULT_CONTROLLER_MAPPING[selected]));
            setListening(false); setError(''); setNotice(`${name} 已恢复默认键位。`);
          }}>恢复此键</button>
        </div>
        <div className="mapping-instructions">
          <span className="mapping-section-label">操作提示</span>
          <p>选择控件后直接按键；已占用的键会自动移到新控件。</p>
          <p><kbd>Esc</kbd> 在等待输入时清除绑定。</p>
          {listening && <button className="text-button" onClick={() => { setListening(false); setNotice('已取消本次按键输入。'); }}>取消本次输入</button>}
        </div>
      </aside>
    </div>
    <div className={'mapping-notice' + (error ? ' error' : '')} role={error ? 'alert' : 'status'}>
      {error || notice}
    </div>
    <footer className="key-mapping-footer">
      <button className="button mapping-reset" disabled={saving} onClick={() => {
        setMapping({ ...DEFAULT_CONTROLLER_MAPPING }); setListening(false); setError(''); setNotice('整套默认映射已恢复，点击“确定”后保存。');
      }}><RotateCcw size={14} />恢复默认</button>
      <span className="mapping-save-state">{changes ? `${changes} 项更改待保存` : '使用当前映射'}</span>
      <div className="key-mapping-actions"><button className="button" disabled={saving} onClick={close}>取消</button><button className="button primary" disabled={saving} onClick={() => void confirm()}><Check size={14} />{saving ? '保存中…' : '确定'}</button></div>
    </footer>
  </dialog>;
}
