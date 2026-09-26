import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Download, ExternalLink, FileCode2, FileText, Folder, FolderOpen, Gamepad2, Image, Package, RefreshCw, Search, Settings2, Upload, WifiOff } from 'lucide-react';
import Markdown from 'react-markdown';
import { Dialog } from './Dialog';
import { gameName, newerVersion, repositoryError, repositoryGame, repositoryGames, repositoryText, type DirectoryMigrationPlan, type InstallPlan, type RepositoryFile, type RepositoryPackage, type RepositoryState } from '../scriptRepository';
import type { GameId } from '../workspace';

const categoryOf = (file: RepositoryFile) => file.category || (/\.il$/i.test(file.path) ? '图像标签' : /\.md$/i.test(file.path) ? '使用说明' : '脚本文件');
const fileSize = (bytes: number) => bytes < 1024 ? `${bytes} 字节` : `${(bytes / 1024).toFixed(1)} 千字节`;
const fileLabel = (name: string) => (name.split('/').at(-1) || name).replace(/^BDSP/i, '珍钻复刻').replace(/^id(?=测种)/i, '训练家编号').replace(/^OCR/i, '文字识别').replace(/^README\.md$/i, '使用说明').replace(/^LICENSE\.md$/i, '许可证');
const fileIcon = (name: string) => /\.il$/i.test(name) ? <Image size={14} /> : /\.md$/i.test(name) ? <FileText size={14} /> : <FileCode2 size={14} />;
const statusOf = (item: RepositoryPackage, local?: RepositoryPackage & { modified: boolean }) => !local ? '未安装' : newerVersion(item.version, local.version) ? '有更新' : newerVersion(local.version, item.version) ? '本地版本较新' : local.modified ? '已安装 · 有修改' : '已安装';
type Selection = { id: string; category?: string; file?: string };

export function ScriptRepositoryDialog({ close, onInstalled, hasUnsaved, currentGame = 'bdsp' }: { close: () => void; onInstalled: () => Promise<void>; hasUnsaved: boolean; currentGame?: GameId }) {
  const api = window.desktop?.scriptRepository;
  const [state, setState] = useState<RepositoryState | null>(null);
  const [game, setGame] = useState<string>(currentGame);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selection, setSelection] = useState<Selection>({ id: '' });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'guide' | 'files'>('guide');
  const [settings, setSettings] = useState(false);
  const [details, setDetails] = useState<Record<string, RepositoryPackage>>({});
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [migration, setMigration] = useState<DirectoryMigrationPlan | null>(null);
  const [policy, setPolicy] = useState<'keep' | 'replace'>('keep');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false), mounted = useRef(false);
  const detailScroll = useRef<HTMLDivElement>(null);
  const migrationSection = useRef<HTMLElement>(null);
  useEffect(() => { migrationSection.current?.scrollIntoView?.({ block: 'nearest' }); }, [migration?.token]);
  useEffect(() => { setGame(currentGame); setSelection({ id: '' }); setPlan(null); }, [currentGame]);
  useEffect(() => {
    let active = true;
    mounted.current = true; pending.current = true; setBusy(true);
    void api?.getState().then(async value => {
      if (!active) return;
      setState(value);
      if (!value.cached) { const next = await api.refresh(); if (active) setState(next); }
    }).catch(cause => { if (active) setError(repositoryError(cause)); }).finally(() => { if (active) { pending.current = false; setBusy(false); } });
    if (!api) { pending.current = false; setBusy(false); }
    return () => { active = false; mounted.current = false; };
  }, [api]);
  const act = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { if (mounted.current) setError(repositoryError(cause)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const installed = new Map((state?.installed || []).map(item => [item.id, item]));
  const available = [...state?.packages || [], ...(state?.installed || []).filter(item => !state?.packages.some(pack => pack.id === item.id))];
  if (plan && !available.some(item => item.id === plan.package.id)) available.push(plan.package);
  const all = available.map(item => details[`${item.id}@${item.version}`] || item);
  const categories = [...repositoryGames, ...Array.from(new Set(all.map(item => repositoryGame(item.game)))).filter(id => !repositoryGames.some(item => item.id === id)).map(id => ({ id, name: gameName(id), description: '' }))];
  const gamePackages = all.filter(item => repositoryGame(item.game) === game);
  const search = query.trim().toLocaleLowerCase();
  const matches = (value: string) => repositoryText(value).toLocaleLowerCase().includes(search) || value.toLocaleLowerCase().includes(search);
  const shown = gamePackages.filter(item => (!search || matches([item.name, item.description, item.game, gameName(item.game), ...item.authors, ...(item.files || []).map(file => file.path + ' ' + categoryOf(file))].join(' ')))
    && (filter === 'all' || filter === 'installed' && installed.has(item.id) || filter === 'updates' && installed.has(item.id) && newerVersion(item.version, installed.get(item.id)!.version)));
  const current = shown.find(item => item.id === selection.id) || shown[0];
  const local = current && installed.get(current.id);
  const selectedCategory = current?.id === selection.id ? selection.category : undefined;
  const selectedFile = current?.id === selection.id ? selection.file : undefined;
  const detailKey = current ? `${current.id}@${current.version}` : '';
  useEffect(() => { if (detailScroll.current) detailScroll.current.scrollTop = 0; }, [detailKey, selectedCategory, selectedFile, tab, settings, plan?.token]);
  useEffect(() => {
    if (!api?.details || !current || current.files || !state?.packages.some(item => item.id === current.id)) { setLoadingDetails(false); return; }
    let active = true; setLoadingDetails(true);
    void api.details(current.id).then(value => { if (active) setDetails(existing => ({ ...existing, [detailKey]: value })); })
      .catch(cause => { if (active) setError(repositoryError(cause)); }).finally(() => { if (active) setLoadingDetails(false); });
    return () => { active = false; };
  }, [api, detailKey, current?.files, state?.packages]);
  const choose = (next: Selection, nextTab: 'guide' | 'files' = 'guide') => { setSelection(next); setTab(nextTab); setPlan(null); setSettings(false); };
  const switchGame = (value: string) => { setGame(value); setQuery(''); setSelection({ id: '' }); setPlan(null); setTab('guide'); setSettings(false); };
  const refresh = () => act(async () => { if (!api) return; setPlan(null); setDetails({}); setState(await api.refresh()); setNotice('仓库目录已更新。'); });
  const preview = (id: string) => act(async () => { if (!api) return; setPlan(await api.prepare(id)); setPolicy('keep'); });
  const importZip = () => act(async () => {
    if (!api) return;
    const next = await api.importZip();
    if (next) { setGame(repositoryGame(next.package.game)); setSelection({ id: next.package.id }); setPlan(next); setPolicy('keep'); setSettings(false); }
  });
  const apply = () => act(async () => {
    if (!api || !plan || hasUnsaved) return;
    const result = await api.apply({ token: plan.token, policy });
    if (!mounted.current) return;
    setState(result.state); setPlan(null);
    setNotice(`安装完成${result.kept ? `，保留 ${result.kept} 项本地修改` : ''}。${result.backupPath ? `原文件备份：${result.backupPath}` : ''}`);
    await onInstalled();
  });
  const chooseDirectory = () => act(async () => {
    if (hasUnsaved || !api?.chooseDirectory) return;
    setPlan(null); setMigration(await api.chooseDirectory());
  });
  const migrateDirectory = () => act(async () => {
    if (hasUnsaved || !migration || !api?.migrateDirectory) return;
    const result = await api.migrateDirectory(migration.token);
    setState(result.state); setMigration(null); setPlan(null);
    setNotice(`脚本目录已迁移。原目录保留为备份：${result.backupPath}`);
    await onInstalled();
  });
  const source = state?.source || 'https://github.com/XiaoyuBook/auto-poke-rng-scripts';
  const sourceLabel = state?.channel === 'gitee' ? 'Gitee' : 'GitHub';
  const files = current?.files || [];
  const visibleFiles = files.filter(file => !selectedCategory || categoryOf(file) === selectedCategory);
  const sourceStatus = state?.catalogSource === 'bundled' ? '内置目录' : error.includes('无法连接') ? '离线浏览' : state?.catalogSource === 'cache' ? '本地缓存' : state?.catalogSource === 'remote' ? '目录已同步' : '尚未同步';

  return <Dialog title="脚本仓库" className="script-repository-dialog" close={() => { if (!pending.current) close(); }}>
    {!api && <p className="repository-message error" role="alert">请在桌面应用中使用脚本仓库。</p>}
    {error && <div className="repository-message error" role="alert"><WifiOff size={16} /><span>{error}</span><button className="text-button" disabled={busy} onClick={() => void refresh()}>重试</button><button className="text-button" disabled={busy} onClick={() => setSettings(true)}>切换渠道</button></div>}
    {hasUnsaved && <p className="repository-message">有未保存的脚本，请先保存后再安装、更新或迁移目录。</p>}
    {notice && <p className="repository-message" role="status">{notice}</p>}
    <div className="repository-body" aria-busy={busy}>
      <nav className="repository-games" aria-label="游戏分类">
        <div className="repository-brand"><Package size={25} /><div><strong>发现脚本</strong><small>为你的游戏选择脚本</small></div></div>
        <p className="repository-nav-label">游戏版本</p>
        {categories.map(item => <button key={item.id} className={game === item.id ? 'selected' : ''} aria-label={'游戏分类：' + item.name} aria-current={game === item.id ? 'true' : undefined} disabled={busy} title={item.description}
          onClick={() => switchGame(item.id)}><Gamepad2 size={18} /><span>{item.name}</span><small>{all.filter(pack => repositoryGame(pack.game) === item.id).length}</small></button>)}
        <div className="repository-nav-footer">
          <button disabled={!api?.openDirectory || busy} onClick={() => void act(async () => { await api?.openDirectory?.(); })}><FolderOpen size={16} />打开脚本目录</button>
          <a href={source} target="_blank" rel="noreferrer"><ExternalLink size={16} />访问官方仓库</a>
          <button className={settings ? 'selected' : ''} disabled={busy} onClick={() => { setSettings(true); setPlan(null); }}><Settings2 size={16} />仓库设置</button>
        </div>
        <div className="repository-source-status"><span className={error ? 'offline' : ''} />{sourceLabel} · {sourceStatus}</div>
      </nav>
      <section className="repository-browser" aria-label="仓库脚本包">
        <header className="repository-browser-header"><h3>{gameName(game)}</h3><span>{gamePackages.length} 个脚本包</span></header>
        <div className="repository-filters" aria-label="脚本包筛选">{[['all','全部'], ['installed','已安装'], ['updates','有更新']].map(([value,label]) => <button key={value} aria-pressed={filter === value} disabled={busy} onClick={() => { setFilter(value); setPlan(null); }}>{label}</button>)}</div>
        <label className="repository-search"><Search size={16} /><input aria-label="搜索仓库脚本" placeholder="搜索脚本、作者或用途" value={query} disabled={busy} onChange={event => { setQuery(event.target.value); setPlan(null); }} /></label>
        <div className="repository-tree">
          {shown.map(item => {
            const itemFiles = item.files || [], groups = Array.from(new Set(itemFiles.map(categoryOf))), expanded = !collapsed.has(item.id);
            return <div key={item.id} className="repository-package">
              <div className={'repository-tree-package ' + (current?.id === item.id && !selectedCategory ? 'selected' : '')}>
                <button className="repository-expand" aria-label={'展开脚本包：' + repositoryText(item.name)} aria-expanded={expanded} disabled={busy} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (expanded) next.add(item.id); else next.delete(item.id); return next; })}><ChevronRight size={15} /></button>
                <button className="repository-package-select" disabled={busy} onClick={() => choose({ id: item.id })}><FolderOpen size={17} /><span><strong>{repositoryText(item.name)}</strong><small>版本 {item.version} · {statusOf(item, installed.get(item.id))}</small></span></button>
              </div>
              {expanded && <div className="repository-tree-groups">{groups.map(category => {
                const key = item.id + '/' + category, open = expandedGroups.has(key), groupedFiles = itemFiles.filter(file => categoryOf(file) === category);
                return <div key={category}>
                  <button className={'repository-category ' + (current?.id === item.id && selectedCategory === category ? 'selected' : '')} aria-label={'用途分类：' + category} aria-expanded={open} disabled={busy} onClick={() => { choose({ id: item.id, category }, 'files'); setExpandedGroups(previous => { const next = new Set(previous); if (open) next.delete(key); else next.add(key); return next; }); }}><ChevronRight size={13} className={open ? 'open' : ''} /><Folder size={15} /><span>{category}</span><small>{groupedFiles.length}</small></button>
                  {open && groupedFiles.map(file => <button key={file.path} className={'repository-tree-file ' + (selectedFile === file.path && current?.id === item.id ? 'selected' : '')} title={file.path} disabled={busy} onClick={() => choose({ id: item.id, category, file: file.path }, 'files')}>{fileIcon(file.path)}<span>{fileLabel(file.path)}</span></button>)}
                </div>;
              })}{!groups.length && <p className="repository-tree-hint">{loadingDetails && current?.id === item.id ? '正在读取文件清单…' : '选择脚本包查看使用说明'}</p>}</div>}
            </div>;
          })}
          {!shown.length && <div className="repository-empty"><FolderOpen size={30} /><strong>{!state ? '正在读取脚本仓库…' : query ? '没有匹配的脚本' : filter === 'installed' ? '还没有安装脚本包' : filter === 'updates' ? '暂无可更新的脚本包' : '这个游戏还没有脚本包'}</strong><p>{query ? '试试其他名称、作者或用途。' : '可切换游戏分类，或导入本地脚本包。'}</p>{(query || filter !== 'all') && <button className="text-button" onClick={() => { setQuery(''); setFilter('all'); }}>查看此游戏的全部脚本</button>}</div>}
        </div>
      </section>
      <section className="repository-detail" aria-label="脚本包详情">
        <div className="repository-toolbar"><span>{settings ? '仓库管理' : plan ? '确认文件变更' : '资源详情'}</span><button className="button" disabled={!api || busy} onClick={() => void refresh()}><RefreshCw size={14} className={busy ? 'repository-spinning' : ''} />{busy ? '正在处理…' : '检查更新'}</button><button className="button" disabled={!api || busy} onClick={() => void importZip()}><Upload size={14} />导入脚本包</button></div>
        <div className="repository-detail-content" ref={detailScroll}>
          {settings ? <div className="repository-settings"><h2>仓库设置</h2><p className="muted">选择适合当前网络的更新渠道，或手动导入下载好的脚本包。</p>
            <label>更新渠道<select aria-label="更新渠道" value={state?.channel || 'github'} disabled={!api?.setChannel || busy} onChange={event => { const channel = event.target.value as 'github' | 'gitee'; void act(async () => { setDetails({}); setState(await api!.setChannel!(channel)); setState(await api!.refresh()); setNotice('更新渠道已切换，仓库目录已更新。'); }); }}><option value="github">GitHub 官方仓库</option><option value="gitee">Gitee 国内仓库</option></select></label>
            <label>仓库地址<input aria-label="仓库地址" readOnly value={source} /></label>
            <div className="repository-settings-actions"><button className="button primary" disabled={!api || busy} onClick={() => void refresh()}><RefreshCw size={15} />更新仓库目录</button><button className="button" disabled={!api || busy} onClick={() => void importZip()}><Upload size={15} />手动导入</button></div>
            <h3>本地脚本</h3><p>安装后可以离线使用。更新会先备份已有目录，并让你选择是否保留个人修改。</p><code className="repository-local-path">{state?.rootPath || '正在读取脚本目录…'}</code>
            <div className="repository-settings-actions"><button className="button" disabled={busy || hasUnsaved || !api?.chooseDirectory} onClick={() => void chooseDirectory()}><FolderOpen size={15} />更改脚本目录</button></div>
            <p className="muted">可以选择其他磁盘上的空文件夹。迁移包含脚本、配套标签和安装记录，原目录保留为备份。</p>
            {migration && <section ref={migrationSection} aria-label="目录迁移预览"><h3>确认迁移目录</h3><p>原目录</p><code className="repository-local-path">{migration.from}</code><p>新目录</p><code className="repository-local-path">{migration.to}</code><p>共 {migration.files} 个文件 · {fileSize(migration.bytes)}。校验完成后立即使用新目录。</p><div className="repository-settings-actions"><button className="button primary" disabled={busy || hasUnsaved} onClick={() => void migrateDirectory()}>迁移并使用此目录</button><button className="button" disabled={busy} onClick={() => setMigration(null)}>取消迁移</button></div></section>}
            <p className="muted">切换渠道只影响目录与下载来源，已有脚本和个人设置会继续保留。</p>
          </div> : plan ? <>
            <div className="repository-detail-heading"><span className="repository-game">{gameName(plan.package.game)}</span><h2>安装预览 · {repositoryText(plan.package.name)}</h2><p>{plan.installedVersion ? `版本 ${plan.installedVersion} → ` : '版本 '}{plan.package.version}</p></div>
            <p className="repository-change-summary">{plan.changes.length} 项文件变更 <span>·</span> {plan.conflicts.length} 项本地修改</p>
            <ul className="repository-changes">{plan.changes.map(change => <li key={change.path}><span>{({ add: '新增', update: '更新', remove: '移除' })[change.action]}</span><code>{change.path}</code>{plan.conflicts.includes(change.path) && <strong>本地已修改</strong>}</li>)}</ul>
            {!plan.changes.length && <p className="muted">文件内容已与仓库一致。</p>}
            {plan.conflicts.length > 0 && <fieldset className="repository-policy"><legend>处理本地修改</legend><label><input type="radio" name="repository-policy" checked={policy === 'keep'} disabled={busy} onChange={() => setPolicy('keep')} />保留我的修改，更新其余文件</label><label><input type="radio" name="repository-policy" checked={policy === 'replace'} disabled={busy} onChange={() => setPolicy('replace')} />备份后使用仓库版本</label></fieldset>}
            <p className="muted">已有文件会先完整备份。脚本和配套标签将一起安装。</p>
            <div className="repository-actions"><button className="button primary" disabled={busy || hasUnsaved} onClick={() => void apply()}><Download size={15} />{busy ? '正在安装…' : '确认安装'}</button><button className="button" disabled={busy} onClick={() => setPlan(null)}>返回详情</button></div>
          </> : current ? <>
            <header className="repository-detail-heading"><span className="repository-game">{gameName(current.game)}</span><h2>{repositoryText(current.name)}</h2><p>{repositoryText(current.description)}</p>
              <div className="repository-authors">作者：{current.authors.map(repositoryText).join('、')}</div>
              <div className="repository-package-meta"><span>版本 {current.version}</span>{current.updatedAt && <span>更新于 {current.updatedAt}</span>}<span className={local ? 'installed' : ''}>{statusOf(current, local)}</span></div>
              <div className="repository-actions"><button className="button primary" disabled={busy || !api || !state?.packages.some(item => item.id === current.id)} onClick={() => void preview(current.id)}><Download size={15} />{local ? '预览更新' : '预览安装'}</button><a className="button" href={source} target="_blank" rel="noreferrer"><ExternalLink size={14} />查看来源</a></div>
            </header>
            <div className="repository-tabs" role="tablist" aria-label="脚本包内容"><button role="tab" aria-selected={tab === 'guide'} onClick={() => setTab('guide')}>使用说明</button><button role="tab" aria-selected={tab === 'files'} onClick={() => setTab('files')}>文件列表{files.length ? `（${files.length}）` : ''}</button></div>
            {tab === 'guide' ? <div className="repository-guide" role="tabpanel" aria-label="使用说明">
              {current.readme ? <Markdown skipHtml urlTransform={url => /^https:\/\//i.test(url) ? url : ''} components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}>{current.readme}</Markdown> : <><h3>使用说明</h3><p>{repositoryText(current.instructions || '请在运行前阅读脚本注释，核对游戏画面、按键和图像标签。')}</p><h3>安装与更新</h3><p>预览文件变更后确认安装。已有目录会完整备份，默认保留你修改过的脚本和图像标签。</p></>}
              <div className="repository-requirement">最低软件版本：{current.minimumAppVersion} · 安装不会自动运行脚本</div>
            </div> : <div className="repository-file-list" role="tabpanel" aria-label="文件列表">
              <div className="repository-file-filter"><strong>{selectedFile || selectedCategory || '全部文件'}</strong>{selectedCategory && <button className="text-button" onClick={() => setSelection({ id: current.id })}>显示全部</button>}<span>{visibleFiles.length} 个文件</span></div>
              <p className="muted">以下为实际安装文件名。脚本与配套资源作为完整包一起安装。</p>
              {visibleFiles.length ? <table><thead><tr><th>文件名称</th><th>用途</th><th>大小</th></tr></thead><tbody>{visibleFiles.map(file => <tr key={file.path} className={selectedFile === file.path ? 'selected' : ''}><td>{fileIcon(file.path)}<span title={file.path}>{file.path}</span></td><td>{categoryOf(file)}</td><td>{fileSize(file.bytes)}</td></tr>)}</tbody></table> : <p>{loadingDetails ? '正在读取文件清单…' : '此目录尚无文件清单，请检查更新。'}</p>}
            </div>}
          </> : <div className="repository-empty repository-detail-empty"><Package size={42} /><h2>选择一个脚本包</h2><p>在左侧选择游戏，浏览脚本用途、使用说明和配套文件。</p>{state?.catalogSource === 'bundled' && <small>当前为内置目录，联网后可检查最新版本。</small>}</div>}
        </div>
        <footer className="repository-footer"><span>{current && !settings && !plan ? `${files.filter(file => /\.(txt|rng)$/i.test(file.path)).length} 个脚本 · ${new Set(files.map(categoryOf)).size} 类用途` : '官方脚本仓库'}</span><span>个人修改受保护 · 安装后可离线使用</span></footer>
      </section>
    </div>
  </Dialog>;
}
