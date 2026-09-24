import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { ExternalLink, Maximize2, Minimize2, Minus, X } from 'lucide-react';
import type { PanelTool } from '../desktop';

export type { PanelTool } from '../desktop';
export interface PanelState { tool: PanelTool; minimized: boolean; expanded: boolean }
type Size = { width: number; height: number };
type ResizeEdge = 'left' | 'top' | 'corner';
const sizeKey = 'auto-poke-rng:panel-size';

function readSize(): Size {
  try {
    const saved = JSON.parse(localStorage.getItem(sizeKey) || 'null');
    if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
      return { width: Math.max(320, saved.width), height: Math.max(260, saved.height) };
    }
  } catch { /* Resizing still works when local storage is unavailable. */ }
  return { width: 400, height: 600 };
}

function constrainSize(size: Size): Size {
  return {
    width: Math.min(Math.max(320, size.width), Math.max(1, window.innerWidth - 44)),
    height: Math.min(Math.max(260, size.height), Math.max(1, window.innerHeight - 122)),
  };
}

interface Props {
  title: string;
  icon: ReactNode;
  state: PanelState;
  minimize: () => void;
  restore: () => void;
  toggleExpanded: () => void;
  close: () => void;
  detach?: () => void;
  detaching?: boolean;
  wide?: boolean;
  contained?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}

export function FloatingSidePanel({ title, icon, state, minimize, restore, toggleExpanded, close, detach, detaching, wide = false, contained = false, actions, children }: Props) {
  const panel = useRef<HTMLElement>(null);
  const [size, setSize] = useState(readSize);
  const drag = useRef<{ x: number; y: number; size: Size; edge: ResizeEdge } | null>(null);
  const titleId = useId();
  const contentId = useId();

  useEffect(() => {
    try { localStorage.setItem(sizeKey, JSON.stringify(size)); } catch { /* Keep the current in-memory size. */ }
  }, [size]);

  const startResize = (event: PointerEvent<HTMLButtonElement>, edge: ResizeEdge) => {
    if (event.button !== 0 || !panel.current) return;
    event.preventDefault();
    const { width, height } = panel.current.getBoundingClientRect();
    drag.current = { x: event.clientX, y: event.clientY, size: { width, height }, edge };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resize = (event: PointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    if (!start) return;
    setSize(constrainSize({
      width: start.size.width + (start.edge === 'top' ? 0 : start.x - event.clientX),
      height: start.size.height + (start.edge === 'left' ? 0 : start.y - event.clientY),
    }));
  };

  useEffect(() => {
    if (!state.minimized) panel.current?.focus();
  }, [state.tool, state.minimized]);

  return (
    <section ref={panel} id="floating-tool-panel" className="floating-side-panel"
      style={{ '--panel-width': size.width + 'px', '--panel-height': size.height + 'px' } as CSSProperties}
      data-expanded={state.expanded} data-minimized={state.minimized} data-wide={wide} data-contained={contained}
      role="dialog" aria-modal="false" aria-labelledby={titleId} tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); close(); }
      }}>
      {!state.minimized && !state.expanded && !wide && (['left', 'top', 'corner'] as const).map(edge => (
        <button key={edge} className={'panel-resize-handle resize-' + edge} type="button"
          aria-label={edge === 'left' ? '调整面板宽度' : edge === 'top' ? '调整面板高度' : '调整面板大小'}
          title="拖动调整大小，或使用方向键"
          onPointerDown={event => startResize(event, edge)} onPointerMove={resize}
          onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const rect = panel.current!.getBoundingClientRect();
            const step = event.shiftKey ? 32 : 10;
            setSize(constrainSize({
              width: rect.width + (edge !== 'top' ? event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0 : 0),
              height: rect.height + (edge !== 'left' ? event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0 : 0),
            }));
          }} />
      ))}
      <header className="floating-panel-header">
        {icon}
        <h2 id={titleId}>{title}</h2>
        <div className="floating-panel-actions">
          {!state.minimized && actions}
          {detach && <button className="icon-button" title="弹出为独立窗口" aria-label="弹出为独立窗口" disabled={detaching} onClick={detach}><ExternalLink size={14} /></button>}
          {state.minimized ? (
            <button className="icon-button" title={'恢复' + title} aria-label={'恢复' + title} aria-controls={contentId} aria-expanded="false" onClick={restore}><Maximize2 size={14} /></button>
          ) : (
            <>
              <button className="icon-button" title={'收起' + title} aria-label={'收起' + title} aria-controls={contentId} aria-expanded="true" onClick={minimize}><Minus size={14} /></button>
              <button className="icon-button" title={state.expanded ? '还原面板大小' : '展开面板'} aria-label={state.expanded ? '还原面板大小' : '展开面板'} aria-pressed={state.expanded} onClick={toggleExpanded}>
                {state.expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </>
          )}
          <button className="icon-button" title={'关闭' + title} aria-label={'关闭' + title} onClick={close}><X size={15} /></button>
        </div>
      </header>
      <div className="floating-panel-body" id={contentId} hidden={state.minimized}>{children}</div>
    </section>
  );
}
