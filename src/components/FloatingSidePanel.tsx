import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Maximize2, Minimize2, Minus, X } from 'lucide-react';

export type PanelTool = 'video' | 'logs';
export interface PanelState { tool: PanelTool; minimized: boolean; expanded: boolean }

interface Props {
  title: string;
  icon: ReactNode;
  state: PanelState;
  minimize: () => void;
  restore: () => void;
  toggleExpanded: () => void;
  close: () => void;
  children: ReactNode;
}

export function FloatingSidePanel({ title, icon, state, minimize, restore, toggleExpanded, close, children }: Props) {
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();
  const contentId = useId();

  useEffect(() => {
    if (!state.minimized) panel.current?.focus();
  }, [state.tool, state.minimized]);

  return (
    <section ref={panel} id="floating-tool-panel" className="floating-side-panel"
      data-expanded={state.expanded} data-minimized={state.minimized}
      role="dialog" aria-modal="false" aria-labelledby={titleId} tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); close(); }
      }}>
      <header className="floating-panel-header">
        {icon}
        <h2 id={titleId}>{title}</h2>
        <div className="floating-panel-actions">
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
