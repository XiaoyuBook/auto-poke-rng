import { useEffect, useRef, useState } from 'react';
import { FileCode2, Files, Plus, Search, X } from 'lucide-react';
import { isScriptDirty, type LibraryScript } from '../scriptLibrary';

interface Props {
  gameName: string;
  scripts: LibraryScript[];
  selectedId: string;
  select: (id: string) => void;
  create: () => void;
}

export function ScriptLibrary({ gameName, scripts, selectedId, select, create }: Props) {
  const [search, setSearch] = useState('');
  const activeButton = useRef<HTMLButtonElement>(null);
  const query = search.trim().toLocaleLowerCase();
  const filtered = scripts.filter(script => (script.name + ' ' + script.description).toLocaleLowerCase().includes(query));
  const personal = filtered.filter(script => !script.example);
  const examples = filtered.filter(script => script.example);
  useEffect(() => { activeButton.current?.scrollIntoView?.({ block: 'nearest' }); }, [selectedId]);

  return <aside className="script-library" aria-label="脚本库">
    <header className="library-header">
      <h2>脚本库</h2>
      <button className="icon-button" title="新建脚本" aria-label="新建脚本" onClick={() => { setSearch(''); create(); }}><Plus size={16} /></button>
    </header>
    <div className="library-search">
      <Search size={14} />
      <input type="search" aria-label="搜索脚本" placeholder="搜索脚本…" value={search} onChange={event => setSearch(event.target.value)} />
      {search && <button className="icon-button" title="清除搜索" aria-label="清除搜索" onClick={() => setSearch('')}><X size={12} /></button>}
    </div>
    <div className="library-scope"><span>{gameName}</span><span>{scripts.length} 个脚本</span></div>
    <div className="library-list">
      {[{ label: '我的脚本', entries: personal }, { label: '示例脚本', entries: examples }].map(group => group.entries.length > 0 && <section key={group.label} className="library-group" aria-label={group.label}>
        <h3>{group.label}</h3>
        {group.entries.map(script => <button key={script.id} ref={script.id === selectedId ? activeButton : undefined}
          className={'script-item ' + (script.id === selectedId ? 'selected' : '')}
          aria-label={'选择脚本：' + script.name} aria-current={script.id === selectedId ? 'true' : undefined}
          title={script.name + '.rng'} onClick={() => select(script.id)}>
          <FileCode2 size={15} />
          <span className="script-item-text"><strong>{script.name || '未命名脚本'}</strong><small>{script.description}</small></span>
          {isScriptDirty(script) && <span className="script-dirty-dot" role="img" aria-label="有未保存的内容" />}
        </button>)}
      </section>)}
      {!filtered.length && <div className="library-empty"><Files size={22} /><p>没有匹配的脚本</p><button className="text-button" onClick={() => setSearch('')}>清除搜索</button></div>}
    </div>
    <footer className="library-footer"><kbd>Ctrl S</kbd><span>保存当前脚本</span></footer>
  </aside>;
}
