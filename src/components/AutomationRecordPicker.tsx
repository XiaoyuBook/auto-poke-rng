import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

type RecordOption = { value: string; label: string; description?: string; group?: string };

export function AutomationPopover({ label, triggerContent, children, role = 'menu', disabled = false, showChevron = true }: {
  label: string; triggerContent: ReactNode; children: (close: () => void) => ReactNode; role?: 'menu' | 'dialog'; disabled?: boolean; showChevron?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: 300 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => { setOpen(false); trigger.current?.focus(); };

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 14, above = rect.top - 14;
    const height = Math.min(300, menu.current.scrollHeight + 2);
    const opensBelow = below >= height || below >= above;
    const maxHeight = Math.max(0, Math.min(300, opensBelow ? below : above));
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - menu.current.getBoundingClientRect().width - 8)),
      top: opensBelow ? rect.bottom + 6 : Math.max(8, rect.top - Math.min(height, maxHeight) - 6),
      maxHeight,
    });
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const selected = menu.current.querySelector<HTMLElement>('[aria-checked="true"]') || menu.current.querySelector<HTMLElement>('input, select, button:not(:disabled)');
    selected?.focus({ preventScroll: true });
    selected?.scrollIntoView?.({ block: 'nearest' });
  }, [open, position.maxHeight]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const relocate = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', relocate, true);
    window.addEventListener('resize', relocate);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', relocate, true);
      window.removeEventListener('resize', relocate);
    };
  }, [open]);

  const keyboard = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') {
      const fields = Array.from(menu.current?.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)') || []);
      if (role === 'menu' || event.shiftKey && event.target === fields[0] || !event.shiftKey && event.target === fields.at(-1)) close();
      return;
    }
    if (role !== 'menu') return;
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled), [role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)') || []);
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
  };

  return <>
    <button ref={trigger} type="button" className="automation-record-picker" aria-label={label} aria-haspopup={role} aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
      {triggerContent}{showChevron && <ChevronDown size={14} aria-hidden="true" />}
    </button>
    {open && createPortal(<div ref={menu} id={id} role={role} aria-label={label} className="automation-record-menu" style={position} onKeyDown={keyboard}>
      {children(close)}
    </div>, document.body)}
  </>;
}

export function AutomationRecordPicker({ label, value, options, onChange, children }: {
  label: string; value: string; options: RecordOption[]; onChange: (value: string) => void; children: ReactNode;
}) {
  return <AutomationPopover label={label} triggerContent={children} disabled={!options.length}>{close => <>
    {options.map((option, index) => <div key={option.value} role="none">
        {option.group && option.group !== options[index - 1]?.group && <div className="automation-record-menu-group" role="presentation">{option.group}</div>}
        <button type="button" role="menuitemradio" tabIndex={-1} aria-checked={option.value === value} onClick={() => { onChange(option.value); close(); }}>
          <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
          {option.value === value && <Check size={14} aria-hidden="true" />}
        </button>
    </div>)}
  </>}</AutomationPopover>;
}
