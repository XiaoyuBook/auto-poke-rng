import { useEffect, useRef, useState } from 'react';
import { Download, Package, RefreshCw, Search, Upload } from 'lucide-react';
import { Dialog } from './Dialog';
import { scriptError } from '../scriptLibrary';
import type { InstallPlan, RepositoryState } from '../scriptRepository';

export function ScriptRepositoryDialog({ close, onInstalled, hasUnsaved }: { close: () => void; onInstalled: () => Promise<void>; hasUnsaved: boolean }) {
  const api = window.desktop?.scriptRepository;
  const [state, setState] = useState<RepositoryState | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState('');
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [policy, setPolicy] = useState<'keep' | 'replace'>('keep');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    pending.current = true; setBusy(true);
    void api?.getState().then(async value => {
      if (!active) return;
      setState(value);
      if (!value.cached) { const next = await api.refresh(); if (active) setState(next); }
    }).catch(cause => { if (active) setError(scriptError(cause)); }).finally(() => { if (active) { pending.current = false; setBusy(false); } });
    if (!api) { pending.current = false; setBusy(false); }
    return () => { active = false; mounted.current = false; };
  }, [api]);
  const act = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { if (mounted.current) setError(scriptError(cause)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const installed = new Map((state?.installed || []).map(item => [item.id, item]));
  const available = [...state?.packages || [], ...(state?.installed || []).filter(item => !state?.packages.some(pack => pack.id === item.id))];
  const shown = available.filter(item => (!query || [item.name, item.description, item.game, ...item.authors].join(' ').toLowerCase().includes(query.toLowerCase()))
    && (filter === 'all' || filter === 'installed' && installed.has(item.id) || filter === 'updates' && installed.has(item.id) && installed.get(item.id)?.version !== item.version));
  const current = shown.find(item => item.id === selected) || shown[0];
  const local = current && installed.get(current.id);
  const preview = async (id: string) => { if (!api) return; setPlan(await api.prepare(id)); setPolicy('keep'); };
  const apply = async () => {
    if (!api || !plan || hasUnsaved) return;
    const result = await api.apply({ token: plan.token, policy });
    if (!mounted.current) return;
    setState(result.state); setPlan(null);
    setNotice(`安装完成${result.kept ? `，保留 ${result.kept} 项本地修改` : ''}。${result.backupPath ? `原文件备份：${result.backupPath}` : ''}`);
    await onInstalled();
  };
  return <Dialog title="脚本仓库" className="script-repository-dialog" close={() => { if (!pending.current) close(); }}>
    <div className="repository-toolbar">
      <label className="repository-search"><Search size={15} /><input aria-label="搜索仓库脚本" placeholder="搜索名称、游戏或作者…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <select aria-label="脚本包筛选" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部脚本包</option><option value="installed">已安装</option><option value="updates">版本不同</option></select>
      <button className="button" disabled={!api || busy} onClick={() => void act(async () => { setPlan(null); setState(await api!.refresh()); setNotice('仓库索引已更新。'); })}><RefreshCw size={14} />检查更新</button>
      <button className="button" disabled={!api || busy} onClick={() => void act(async () => { setPlan(await api!.importZip()); setPolicy('keep'); })}><Upload size={14} />导入 ZIP</button>
    </div>
    {!api && <p className="repository-message" role="alert">请在桌面应用中使用脚本仓库。</p>}
    {error && <p className="repository-message error" role="alert">{error}</p>}
    {hasUnsaved && <p className="repository-message">有未保存的脚本，请先保存后再安装或更新。</p>}
    {notice && <p className="repository-message" role="status">{notice}</p>}
    <div className="repository-body" aria-busy={busy}>
      <nav className="repository-list" aria-label="仓库脚本包">
        {shown.map(item => <button key={item.id} className={current?.id === item.id ? 'selected' : ''} onClick={() => { setSelected(item.id); setPlan(null); }} disabled={busy}>
          <Package size={18} /><span><strong>{item.name}</strong><small>{item.game} · v{item.version}</small><small>{installed.has(item.id) ? installed.get(item.id)?.version === item.version ? '已安装' : '版本不同' : '可安装'}</small></span>
        </button>)}
        {!shown.length && <p className="muted">{state ? '暂无匹配的脚本包，可检查更新或导入 ZIP。' : '正在读取脚本仓库…'}</p>}
      </nav>
      <section className="repository-detail" aria-label="脚本包详情">
        {plan ? <>
          <h3>安装预览 · {plan.package.name}</h3>
          <p>{plan.installedVersion ? `v${plan.installedVersion} → ` : ''}v{plan.package.version} · {plan.package.installFolder}</p>
          <p>{plan.changes.length} 项文件变更 · {plan.conflicts.length} 项本地修改</p>
          <ul className="repository-changes">{plan.changes.map(change => <li key={change.path}><span>{({ add: '新增', update: '更新', remove: '移除' })[change.action]}</span>{change.path}{plan.conflicts.includes(change.path) && <strong>本地已修改</strong>}</li>)}</ul>
          {plan.conflicts.length > 0 && <fieldset className="repository-policy"><legend>处理本地修改</legend>
            <label><input type="radio" name="repository-policy" checked={policy === 'keep'} onChange={() => setPolicy('keep')} />保留我的修改，更新其余文件</label>
            <label><input type="radio" name="repository-policy" checked={policy === 'replace'} onChange={() => setPolicy('replace')} />备份后使用仓库版本</label>
          </fieldset>}
          <p className="muted">已有文件会先完整备份。安装后可在脚本库编辑，并在自动流程中选择使用。</p>
          <div className="repository-actions"><button className="button primary" disabled={busy || hasUnsaved} onClick={() => void act(apply)}><Download size={14} />{busy ? '正在安装…' : '确认安装'}</button><button className="button" disabled={busy} onClick={() => setPlan(null)}>返回详情</button></div>
        </> : current ? <>
          <span className="repository-game">{current.game}</span><h3>{current.name}</h3>
          <p className="muted">v{current.version} · {current.authors.join('、')}</p><p>{current.description}</p>
          {current.instructions && <div className="repository-instructions"><h4>使用说明</h4><p>{current.instructions}</p></div>}
          <dl><dt>安装位置</dt><dd>{current.installFolder}</dd><dt>最低软件版本</dt><dd>{current.minimumAppVersion}</dd><dt>本地状态</dt><dd>{local ? `已安装 v${local.version}${local.modified ? ' · 有本地修改' : ''}` : '尚未安装'}</dd></dl>
          <button className="button primary" disabled={busy || !api || !state?.packages.some(item => item.id === current.id)} onClick={() => void act(() => preview(current.id))}><Download size={14} />{local ? '预览更新' : '预览安装'}</button>
        </> : <p className="muted">选择脚本包查看说明与安装信息。</p>}
      </section>
    </div>
    <footer className="repository-footer"><span>官方脚本仓库 · 安装后可离线运行</span><span title={state?.rootPath}>脚本与个人设置保存在用户目录</span></footer>
  </Dialog>;
}
