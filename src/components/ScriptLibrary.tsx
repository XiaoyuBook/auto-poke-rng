import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, FileCode2, Folder, FolderOpen, Package, Plus, RefreshCw, Search, X } from 'lucide-react';
import { ScriptRepositoryDialog } from './ScriptRepositoryDialog';
import { isScriptDirty, parentFolder, type LibraryScript, type ScriptFolder } from '../scriptLibrary';
import type { GameId } from '../workspace';

interface Props {
  game?: GameId;
  scripts: LibraryScript[];
  folders: ScriptFolder[];
  selectedPath?: string;
  rootPath: string;
  busy: boolean;
  loaded: boolean;
  available: boolean;
  error: string;
  warnings: string[];
  select: (path: string) => void;
  create: (folder: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function ScriptLibrary(props: Props) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const createMenu = useRef<HTMLDivElement>(null);
  const activeButton = useRef<HTMLButtonElement>(null);
  const query = search.trim().toLocaleLowerCase();
  const filtered = props.scripts.filter(script => (script.path + ' ' + script.name).toLocaleLowerCase().includes(query));
  const folders = [...props.folders];
  // Deleted folders can still contain unsaved buffers; keep those reachable.
  for (const script of props.scripts) {
    let folder = parentFolder(script.path);
    while (folder) {
      if (!folders.some(item => item.path === folder)) folders.push({ path: folder, name: folder.split('/').at(-1)! });
      folder = parentFolder(folder);
    }
  }
  useEffect(() => {
    setExpanded(current => {
      const next = new Set(current);
      let parent = parentFolder(props.selectedPath || '');
      while (parent) { next.add(parent); parent = parentFolder(parent); }
      return next;
    });
    activeButton.current?.scrollIntoView?.({ block: 'nearest' });
  }, [props.selectedPath]);
  useEffect(() => {
    if (!creating) return;
    const outside = (event: PointerEvent) => { if (!createMenu.current?.contains(event.target as Node)) setCreating(false); };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [creating]);

  const create = (folder: string) => { setSearch(''); setCreating(false); void props.create(folder); };
  const renderFolder = (parent: string, depth: number): ReactNode => {
    const children = folders.filter(folder => parentFolder(folder.path) === parent
      && (!query || folder.path.toLocaleLowerCase().includes(query) || filtered.some(script => script.path.startsWith(folder.path + '/'))))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    const files = filtered.filter(script => parentFolder(script.path) === parent)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    return <>
      {children.map(folder => {
        const open = Boolean(query) || expanded.has(folder.path);
        const count = props.scripts.filter(script => script.path.startsWith(folder.path + '/')).length;
        return <div className="library-folder" key={folder.path}>
          <button className="library-folder-button" style={{ paddingLeft: 6 + depth * 16 }} aria-label={'文件夹：' + folder.path} aria-expanded={open}
            title={'scripts/' + folder.path} onClick={() => setExpanded(current => {
              const next = new Set(current); if (open) next.delete(folder.path); else next.add(folder.path); return next;
            })}>
            <ChevronRight size={12} className={open ? 'folder-chevron open' : 'folder-chevron'} />
            {open ? <FolderOpen size={15} /> : <Folder size={15} />}<span>{folder.name}</span><small>{count}</small>
          </button>
          {open && <div className="library-folder-contents">
            {renderFolder(folder.path, depth + 1)}
            {!count && !folders.some(child => parentFolder(child.path) === folder.path) && <p className="folder-empty" style={{ paddingLeft: 26 + depth * 16 }}>暂无脚本</p>}
          </div>}
        </div>;
      })}
      {files.map(script => <button key={script.path} ref={script.path === props.selectedPath ? activeButton : undefined}
        className={'script-item ' + (script.path === props.selectedPath ? 'selected' : '')} style={{ paddingLeft: 24 + depth * 16 }}
        aria-label={'选择脚本：' + script.name} aria-current={script.path === props.selectedPath ? 'true' : undefined}
        title={'scripts/' + script.path + (script.missing ? '（文件已移除，编辑仍保留）' : '')} onClick={() => props.select(script.path)}>
        <FileCode2 size={14} /><span className="script-item-text">{script.name || '未命名脚本'}</span>
        {isScriptDirty(script) && <span className="script-dirty-dot" role="img" aria-label="有未保存的内容" />}
      </button>)}
    </>;
  };

  return <aside className="script-library" aria-label="脚本库">
    <header className="library-header">
      <h2>脚本库</h2>
      <button className="icon-button" title="脚本仓库" aria-label="打开脚本仓库" onClick={() => setRepositoryOpen(true)}><Package size={15} /></button>
      <button className="icon-button" title="重新读取 scripts 文件夹" aria-label="刷新脚本库" disabled={props.busy || !props.available} onClick={() => void props.refresh()}><RefreshCw size={14} /></button>
      <div className="library-create" ref={createMenu} onKeyDown={event => { if (event.key === 'Escape') { setCreating(false); createMenu.current?.querySelector('button')?.focus(); } }}>
        <button className="icon-button" title="新建脚本" aria-label="新建脚本" aria-expanded={creating} disabled={props.busy || !props.loaded} onClick={() => setCreating(value => !value)}><Plus size={16} /></button>
        {creating && <div className="library-create-menu" aria-label="新建脚本位置">
          <p>新建脚本到</p>
          {[{ path: '', name: 'scripts（根目录）' }, ...props.folders].map(folder => <button key={folder.path} onClick={() => create(folder.path)}><Folder size={14} /><span>{folder.path || folder.name}</span></button>)}
        </div>}
      </div>
    </header>
    <div className="library-search">
      <Search size={14} /><input type="search" aria-label="搜索脚本" placeholder="搜索脚本…" value={search} onChange={event => setSearch(event.target.value)} />
      {search && <button className="icon-button" title="清除搜索" aria-label="清除搜索" onClick={() => setSearch('')}><X size={12} /></button>}
    </div>
    <div className="library-scope" title={props.rootPath}><span>scripts</span><span>{props.scripts.length} 个脚本</span></div>
    {props.error && <p className="library-error" role="alert">{props.error}</p>}
    <div className="library-list" aria-busy={props.busy}>
      {renderFolder('', 0)}
      {!props.available && <div className="library-empty"><Folder size={22} /><p>请在桌面应用中打开项目脚本库</p></div>}
      {props.available && !props.loaded && props.busy && <div className="library-empty"><p>正在读取脚本库…</p></div>}
      {props.loaded && !props.scripts.length && !folders.length && <div className="library-empty"><FolderOpen size={22} /><p>scripts 文件夹为空</p><span>添加文件夹和 .txt 脚本后刷新</span></div>}
      {query && !filtered.length && <div className="library-empty"><p>没有匹配的脚本</p><button className="text-button" onClick={() => setSearch('')}>清除搜索</button></div>}
    </div>
    {props.warnings.length > 0 && <details className="library-warnings"><summary>{props.warnings.length} 项未能读取</summary>{props.warnings.map(warning => <p key={warning}>{warning}</p>)}</details>}
    <footer className="library-footer"><kbd>Ctrl S</kbd><span>保存当前文件</span></footer>
    {repositoryOpen && <ScriptRepositoryDialog currentGame={props.game} close={() => setRepositoryOpen(false)} onInstalled={props.refresh} hasUnsaved={props.scripts.some(isScriptDirty)} />}
  </aside>;
}
