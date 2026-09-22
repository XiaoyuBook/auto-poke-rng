import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, CornerDownLeft, Search } from 'lucide-react';
import { Dialog } from './Dialog';

export interface CommandAction { label: string; keywords: string; icon: ReactNode; run: () => void }

export function CommandPalette({ actions, close }: { actions: CommandAction[]; close: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const filtered = actions.filter(action => (action.label + ' ' + action.keywords).toLowerCase().includes(query.trim().toLowerCase()));
  const execute = (index: number) => {
    const action = filtered[index];
    if (!action) return;
    close();
    // Allow the native dialog to restore focus before mounting another dialog.
    requestAnimationFrame(action.run);
  };

  return (
    <Dialog title="快速查找" close={close} className="command-dialog">
      <div className="command-search"><Search size={17} /><input
        autoFocus aria-label="搜索页面或工具" placeholder="搜索页面、工具…"
        role="combobox" aria-expanded="true" aria-controls="command-results"
        aria-activedescendant={filtered.length ? 'command-' + selected : undefined}
        value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (filtered.length) setSelected(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length);
          }
          if (event.key === 'Enter') { event.preventDefault(); execute(selected); }
        }} /><kbd>Esc</kbd></div>
      <div className="command-results" id="command-results" role="listbox" aria-label="搜索结果">
        {filtered.map((action, index) => (
          <button key={action.label} id={'command-' + index} role="option" aria-selected={index === selected}
            className={'command-result ' + (index === selected ? 'selected' : '')}
            onMouseEnter={() => setSelected(index)} onClick={() => execute(index)}>
            {action.icon}<span>{action.label}</span>{index === selected && <CornerDownLeft size={14} />}
          </button>
        ))}
        {!filtered.length && <p className="command-empty">没有找到“{query}”相关的页面或工具。</p>}
      </div>
      <footer className="command-footer"><span><ArrowUp size={12} /><ArrowDown size={12} /> 选择</span><span><CornerDownLeft size={12} /> 打开</span></footer>
    </Dialog>
  );
}
