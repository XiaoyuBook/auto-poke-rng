import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { FRLG_DEX, getFrlgDexRoutes, type FrlgDexRoute } from '../frlgDex';
import { getFrlgLocationLabel } from '../frlgAutomation';
import type { FrlgSaveProfile } from '../frlgProfile';
import { FrlgSprite } from './FrlgSprite';

const regions = [{ label: '关都', min: 1, max: 151 }, { label: '城都', min: 152, max: 251 }, { label: '丰缘', min: 252, max: 386 }, { label: '全部', min: 1, max: 386 }];
const categories: Record<string, string> = { Starter: '御三家', Fossil: '化石', Gift: '赠送', GameCorner: '游戏厅', Stationary: '定点', Legend: '传说', Event: '活动', Roaming: '游走', Grass: '草丛', Surfing: '冲浪', OldRod: '破旧钓竿', GoodRod: '好钓竿', SuperRod: '厉害钓竿', RockSmash: '碎岩' };
const pageSize = 15;

export function FrlgPokedex({ profile, onComplete, onChooseTarget }: { profile: FrlgSaveProfile; onComplete: (id: number, completed: boolean) => void; onChooseTarget: (route: FrlgDexRoute) => void }) {
  const [region, setRegion] = useState(0);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [searchableOnly, setSearchableOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState(1);
  const [routeIndex, setRouteIndex] = useState(0);
  const completed = useMemo(() => new Set(profile.completedSpecies || []), [profile.completedSpecies]);
  const routes = useMemo(() => getFrlgDexRoutes(profile.game), [profile.game]);
  const query = search.trim().toLowerCase().replace(/^#/, '');
  const matches = FRLG_DEX.filter(entry => entry.id >= regions[region].min && entry.id <= regions[region].max
    && (status === 'all' || completed.has(entry.id) === (status === 'complete'))
    && (!searchableOnly || routes.has(entry.id))
    && (!query || entry.name.includes(query) || entry.species.toLowerCase().includes(query) || String(entry.id).padStart(3, '0').includes(query)));
  const lastPage = Math.max(0, Math.ceil(matches.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const selected = FRLG_DEX.find(entry => entry.id === selectedId)!;
  const selectedRoutes = routes.get(selectedId) || [];
  const selectedRoute = selectedRoutes[Math.min(routeIndex, selectedRoutes.length - 1)];
  const percentage = (completed.size / FRLG_DEX.length * 100).toFixed(1);
  const filter = (change: () => void) => { change(); setPage(0); };
  return <section className="frlg-pokedex" aria-label="乱数图鉴">
    <header className="frlg-dex-heading"><h3>乱数图鉴</h3><span>已完成 <strong>{completed.size}</strong> / {FRLG_DEX.length}</span><small>全国进度 {percentage}%</small></header>
    <progress className="frlg-dex-progress" aria-label="全国乱数图鉴进度" max={FRLG_DEX.length} value={completed.size}/>
    <div className="frlg-dex-filters">
      <div className="frlg-dex-regions" role="group" aria-label="图鉴地区">{regions.map((item, index) => <button type="button" key={item.label} aria-pressed={region === index} onClick={() => filter(() => setRegion(index))}>{item.label}</button>)}</div>
      <select aria-label="图鉴完成状态" value={status} onChange={event => filter(() => setStatus(event.target.value))}><option value="all">全部状态</option><option value="incomplete">未完成</option><option value="complete">已完成</option></select>
      <label className="frlg-dex-searchable"><input type="checkbox" checked={searchableOnly} onChange={event => filter(() => setSearchableOnly(event.target.checked))}/>可搜索目标</label>
      <label className="frlg-dex-search"><Search size={14} aria-hidden="true"/><input aria-label="搜索图鉴" placeholder="名称或图鉴编号" value={search} onChange={event => filter(() => setSearch(event.target.value))}/></label>
    </div>
    <p className="frlg-dex-hint">点击宝可梦挑选目标，勾选记录完成进度。进度自动保存。</p>
    <div className="frlg-dex-results"><div className="frlg-dex-grid">{matches.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(entry => <article key={entry.id} className={`frlg-dex-entry${completed.has(entry.id) ? ' is-complete' : ''}${selectedId === entry.id ? ' is-selected' : ''}`}>
      <button type="button" className="frlg-dex-select" aria-label={`选择 ${entry.name} #${String(entry.id).padStart(3, '0')}`} aria-pressed={selectedId === entry.id} onClick={() => { setSelectedId(entry.id); setRouteIndex(0); }}><small>#{String(entry.id).padStart(3, '0')}</small><span className="frlg-dex-sprite"><FrlgSprite species={entry.species}/></span><strong>{entry.name}</strong></button>
      <input type="checkbox" className="frlg-dex-check" aria-label={`标记${entry.name}已完成`} checked={completed.has(entry.id)} onChange={event => onComplete(entry.id, event.target.checked)}/>
    </article>)}</div>
    {!matches.length && <p className="frlg-dex-empty" role="status">没有符合条件的宝可梦，请调整筛选条件。</p>}</div>
    <footer className="frlg-dex-pagination"><span>筛选结果 {matches.length} 只</span><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {lastPage + 1}</span><button type="button" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>下一页</button></footer>
    <div className="frlg-dex-target" aria-label="选中的图鉴目标">
      <span className="frlg-dex-target-sprite"><FrlgSprite species={selected.species}/></span>
      <div className="frlg-dex-target-name"><strong>{selected.name}</strong><small>#{String(selected.id).padStart(3, '0')} · {completed.has(selected.id) ? '已完成' : '未完成'}</small></div>
      {selectedRoutes.length ? <select aria-label="图鉴目标遭遇" value={Math.min(routeIndex, selectedRoutes.length - 1)} onChange={event => setRouteIndex(Number(event.target.value))}>{selectedRoutes.map((route, index) => <option value={index} key={`${route.category}:${route.location}`}>{categories[route.category]}{route.location ? ` · ${getFrlgLocationLabel(route.location)}` : ''}</option>)}</select> : <span className="frlg-dex-unavailable">当前版本暂无可搜索遭遇，可记录完成进度。</span>}
      <button type="button" className="button primary" disabled={!selectedRoute} onClick={() => selectedRoute && onChooseTarget(selectedRoute)}>设为乱数目标</button>
    </div>
  </section>;
}
