import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import { NATURES_ZH } from '../staticData';

export function LeadSelector({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const sync = useRef<HTMLButtonElement>(null);
  const submenu = useRef<HTMLDivElement>(null);
  const close = () => { setPosition(null); setSyncOpen(false); trigger.current?.focus(); };
  const choose = (next: number) => { onChange(next); close(); };
  useEffect(() => {
    if (!position) return;
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) { setPosition(null); setSyncOpen(false); }
    };
    const relocate = (event: Event) => { if (!menu.current?.contains(event.target as Node)) { setPosition(null); setSyncOpen(false); } };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', relocate);
    document.addEventListener('scroll', relocate, true);
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', relocate); document.removeEventListener('scroll', relocate, true); };
  }, [position]);
  const openSync = (focus: boolean) => {
    setSyncOpen(true);
    if (focus) requestAnimationFrame(() => submenu.current?.querySelector<HTMLButtonElement>('button')?.focus());
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') { setPosition(null); setSyncOpen(false); return; }
    if (event.key === 'ArrowRight' && event.target === sync.current) { event.preventDefault(); openSync(true); return; }
    if (event.key === 'ArrowLeft' && submenu.current?.contains(event.target as Node)) { event.preventDefault(); setSyncOpen(false); sync.current?.focus(); return; }
    const parent = (event.target as HTMLElement).closest('[role="menu"]');
    const buttons = Array.from(parent?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? []);
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
  };
  const label = value === 255 ? '无' : value <= 24 ? `同步：${NATURES_ZH[value]}` : value === 25 ? '迷人之躯 ♀' : '迷人之躯 ♂';
  return <div className="lead-selector">
    <button ref={trigger} className="lead-selector-trigger" type="button" aria-label="队首" aria-haspopup="menu" aria-expanded={Boolean(position)} onClick={() => {
      if (position) { close(); return; }
      const rect = trigger.current!.getBoundingClientRect();
      setPosition({ left: Math.min(rect.left, window.innerWidth - 164), top: Math.min(rect.bottom + 3, window.innerHeight - 148) });
    }}>{label}</button>
    {position && createPortal(<div ref={menu} className="lead-selector-menu" role="menu" aria-label="队首选项" style={position} onKeyDown={keyboard}>
      <button type="button" role="menuitemradio" aria-checked={value === 255} onMouseEnter={() => setSyncOpen(false)} onClick={() => choose(255)}>无</button>
      <button ref={sync} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={syncOpen} onMouseEnter={() => openSync(false)} onClick={() => openSync(true)}>同步<ChevronRight size={14} /></button>
      {syncOpen && <div ref={submenu} className="lead-selector-submenu" role="menu" aria-label="同步性格" style={{ left: position.left + 320 > window.innerWidth ? position.left - 152 : position.left + 150, top: Math.max(8, Math.min(position.top + 32, window.innerHeight - 320)) }}>
        {NATURES_ZH.map((nature, index) => <button key={nature} type="button" role="menuitemradio" aria-checked={value === index} onClick={() => choose(index)}>{nature}</button>)}
      </div>}
      <div className="lead-selector-divider" />
      <button type="button" role="menuitemradio" aria-checked={value === 25} onMouseEnter={() => setSyncOpen(false)} onClick={() => choose(25)}>迷人之躯 ♀</button>
      <button type="button" role="menuitemradio" aria-checked={value === 26} onMouseEnter={() => setSyncOpen(false)} onClick={() => choose(26)}>迷人之躯 ♂</button>
    </div>, document.body)}
  </div>;
}
