import { ExternalLink, FileClock, Minus, MonitorPlay } from 'lucide-react';
import type { PanelTool } from '../desktop';
import type { PanelState } from './FloatingSidePanel';

interface Props {
  panel: PanelState | null;
  detached: PanelTool[];
  toggle: (tool: PanelTool) => void;
  buttons: Partial<Record<PanelTool, HTMLButtonElement | null>>;
}

const tools = [
  { id: 'video', label: '视频', title: '视频预览', icon: MonitorPlay },
  { id: 'logs', label: '日志', title: '日志中心', icon: FileClock },
] as const;

export function QuickTools({ panel, detached, toggle, buttons }: Props) {
  return <div className="quick-dock" role="toolbar" aria-label="快捷工具">
    {tools.map(({ id, label, title, icon: Icon }) => {
      const inline = panel?.tool === id;
      const state = detached.includes(id) ? 'detached' : inline ? panel.minimized ? 'minimized' : 'open' : 'closed';
      const hint = state === 'detached' ? '已弹出，点击显示窗口' : state === 'minimized' ? '已收起，点击恢复' : state === 'open' ? '点击收起面板' : '点击打开面板';
      return <button key={id} ref={node => { buttons[id] = node; }} type="button" className="quick-tool-button" data-state={state}
        title={title + ' · ' + hint} aria-label={title} aria-pressed={state === 'open' || state === 'detached'}
        aria-expanded={state === 'open'} aria-controls={inline ? 'floating-tool-panel' : undefined} aria-haspopup="dialog" onClick={() => toggle(id)}>
        <Icon size={14} />
        <span>{label}</span>
        <span className="quick-tool-indicator" aria-hidden="true">
          {state === 'detached' ? <ExternalLink size={11} /> : state === 'minimized' ? <Minus size={11} /> : null}
        </span>
      </button>;
    })}
  </div>;
}
