import { useEffect, useMemo, useRef, useState } from 'react';
import { ListChecks, Play, SlidersHorizontal, Sparkles, Square } from 'lucide-react';
import {
  FRLG_GAMES,
  FRLG_HIDDEN_TYPES,
  FRLG_WILD_CATEGORIES,
  FRLG_METHODS,
  FRLG_NATURES,
  FRLG_SHININESS,
  FRLG_STATIC_CATEGORIES,
  defaultFrlgStaticRequest,
  getFrlgLocationLabel,
  getFrlgStaticTargets,
  getFrlgWildLocations,
  getFrlgWildTargets,
  getFrlgAbilities,
  toFrlgPlannerPayload,
  validateFrlgStaticRequest,
  type FrlgStaticRequest,
  type FrlgStaticTarget,
  type FrlgWildTarget,
  type FrlgPlannerResult,
} from '../frlgAutomation';
import { Dialog } from './Dialog';
import { FrlgPlanSummary, FrlgPlanDetails } from './FrlgPlanResult';
import { FrlgSprite } from './FrlgSprite';
import { FRLG_ABILITY_LABELS, FRLG_NATURE_LABELS, FRLG_TYPE_LABELS } from '../frlgMetadata';
import type { FrlgSaveProfile } from '../frlgProfile';

const gameLabels: Record<string, string> = {
  fr_nx: '火红 · 美版 · Switch 1', fr_nx2: '火红 · 美版 · Switch 2',
  lg_nx: '叶绿 · 美版 · Switch 1', lg_nx2: '叶绿 · 美版 · Switch 2',
  fr_jpn_nx: '火红 · 日版 · Switch 1', fr_jpn_nx2: '火红 · 日版 · Switch 2',
  lg_jpn_nx: '叶绿 · 日版 · Switch 1', lg_jpn_nx2: '叶绿 · 日版 · Switch 2',
};
const categoryLabels: Record<string, string> = {
  Starter: '御三家', Fossil: '化石', Gift: '赠送', GameCorner: '游戏中心',
  Stationary: '定点', Legend: '传说', Event: '事件', Roaming: '游走',
  Grass: '草丛', Surfing: '冲浪', OldRod: '破旧钓竿', GoodRod: '好钓竿', SuperRod: '厉害钓竿', RockSmash: '碎岩',
};
const methodLabels: Record<string, string> = {
  Static: 'Static', 'Static 1': 'Static 1', 'Static 2': 'Static 2', 'Static 4': 'Static 4',
  Wild: 'Wild', 'Wild 1': 'Wild 1', 'Wild 2': 'Wild 2', 'Wild 4': 'Wild 4', 'All Wild Methods': '全部野生方法',
};
const statLabels = ['HP', '攻击', '防御', '特攻', '特防', '速度'];
const natureLabels: Record<string, string> = FRLG_NATURE_LABELS;
const abilityLabels: Record<string, string> = FRLG_ABILITY_LABELS;
const typeLabels: Record<string, string> = FRLG_TYPE_LABELS;
const shinyLabels: Record<string, string> = { None: '非闪光', Star: '星形闪光', Square: '方形闪光', 'Star/Square': '星形／方形闪光' };

type PlanResult = FrlgPlannerResult;
type FrlgTarget = FrlgStaticTarget | FrlgWildTarget;

const rangeText = (min: number, max: number) => min === max ? String(min) : `${min}–${max}`;

function targetTerms(request: FrlgStaticRequest) {
  const terms: { text: string; shiny?: boolean }[] = [];
  if (request.shiny !== 'Any') terms.push({ text: shinyLabels[request.shiny] || request.shiny, shiny: true });
  if (request.nature !== 'Any') terms.push({ text: `性格 ${natureLabels[request.nature] || request.nature}` });
  if (request.gender !== 'Any') terms.push({ text: `性别 ${request.gender === 'M' ? '雄性' : request.gender === 'F' ? '雌性' : '无性别'}` });
  if (request.ability !== 'Any') terms.push({ text: `特性 ${abilityLabels[request.ability] || request.ability}` });
  if (request.hiddenType !== 'Any') terms.push({ text: `隐藏属性 ${typeLabels[request.hiddenType] || request.hiddenType}` });
  request.ivMin.forEach((min, index) => {
    const max = request.ivMax[index];
    if (min !== 0 || max !== 31) terms.push({ text: `${statLabels[index]} ${rangeText(min, max)}` });
  });
  return terms.length ? terms : [{ text: '不限条件' }];
}

const wildMethod = (method: string) => method.includes('Wild');
function FrlgTargetCard({ request, target, locked, onSettings }: {
  request: FrlgStaticRequest;
  target?: FrlgTarget;
  locked: boolean;
  onSettings: () => void;
}) {
  const terms = targetTerms(request);
  return <section className="automation-target-card frlg-target-card" aria-label="当前火叶目标与筛选条件">
    <header className="automation-target-heading">
      <strong>当前目标</strong>
      <button type="button" className="automation-target-settings" disabled={locked} onClick={onSettings}><SlidersHorizontal size={14} aria-hidden="true" />目标设置</button>
    </header>
    <div className="automation-target-main">
      <span className="frlg-target-emblem"><FrlgSprite species={request.pokemon} /></span>
      <div className="automation-target-identity">
        <strong>{target?.displayName || request.pokemon}</strong>
        <small>{target?.species || request.pokemon} · {gameLabels[request.game] || request.game}</small>
        <small>{categoryLabels[request.category] || request.category} · {methodLabels[request.method] || request.method}{target && 'location' in target ? ` · ${getFrlgLocationLabel(target.location)}` : ''}</small>
      </div>
    </div>
    <div className="automation-target-conditions">
      <div className="automation-target-conditions-heading"><span>目标条件 <b>{terms.length} 项</b></span><small>同组条件同时满足</small></div>
      <ul className="automation-target-condition-list">{terms.slice(0, 4).map((term, index) => <li key={`${term.text}-${index}`}><div className="automation-target-condition-terms">{term.shiny ? <span className="automation-target-shiny-term"><Sparkles size={12} aria-hidden="true" />{term.text}</span> : <span>{term.text}</span>}</div></li>)}</ul>
      {terms.length > 4 && <button type="button" className="automation-target-more" onClick={onSettings}>查看全部 {terms.length} 项条件</button>}
    </div>
  </section>;
}

export function FrlgAutomationWorkspace({ profile }: { profile?: FrlgSaveProfile }) {
  const [request, setRequest] = useState<FrlgStaticRequest>(() => {
    const base = defaultFrlgStaticRequest();
    return profile ? { ...base, game: profile.game, tid: profile.tid, sid: profile.sid } : base;
  });
  const [result, setResult] = useState<PlanResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [targetSettingsOpen, setTargetSettingsOpen] = useState(false);
  const [resultDetailOpen, setResultDetailOpen] = useState(false);
  const searchGeneration = useRef(0);
  const pendingSearch = useRef(false);
  const invalidate = () => {
    searchGeneration.current += 1;
    setResult(null); setError(''); setNotice(''); setResultDetailOpen(false);
    if (pendingSearch.current) {
      pendingSearch.current = false;
      void window.desktop?.frlgRng?.cancel().catch(() => {});
      setBusy(false);
    }
  };
  useEffect(() => () => {
    searchGeneration.current += 1;
    if (pendingSearch.current) void window.desktop?.frlgRng?.cancel().catch(() => {});
  }, []);
  const requestTargets = (game: string, category: string, method: string, location: string): FrlgTarget[] => wildMethod(method)
    ? getFrlgWildTargets(game, category as typeof FRLG_WILD_CATEGORIES[number], location)
    : getFrlgStaticTargets(game, category as typeof FRLG_STATIC_CATEGORIES[number]);
  const requestLocations = (game: string, category: string, method: string) => wildMethod(method) ? getFrlgWildLocations(game, category) : [];
  useEffect(() => {
    if (!profile) return;
    invalidate();
    setRequest(current => {
      const locations = requestLocations(profile.game, current.category, current.method);
      const location = wildMethod(current.method) && !locations.includes(current.location) ? locations[0] || '' : current.location;
      const nextTargets = requestTargets(profile.game, current.category, current.method, location);
      const pokemon = nextTargets.some(item => item.species === current.pokemon) ? current.pokemon : nextTargets[0]?.species || 'Bulbasaur';
      return { ...current, game: profile.game, tid: profile.tid, sid: profile.sid, location, pokemon };
    });
  }, [profile?.id, profile?.game, profile?.tid, profile?.sid]);
  const locations = useMemo(() => requestLocations(request.game, request.category, request.method), [request.game, request.category, request.method]);
  const targets = useMemo(() => requestTargets(request.game, request.category, request.method, request.location), [request.game, request.category, request.method, request.location]);
  const target = targets.find(item => item.species === request.pokemon) || targets[0];
  const diagnostics = validateFrlgStaticRequest(request);
  const update = <K extends keyof FrlgStaticRequest>(key: K, value: FrlgStaticRequest[K]) => {
    invalidate(); setRequest(current => ({ ...current, [key]: value }));
  };
  const changeGame = (game: string) => {
    const nextLocations = requestLocations(game, request.category, request.method);
    const location = wildMethod(request.method) && !nextLocations.includes(request.location) ? nextLocations[0] || '' : request.location;
    const nextTargets = requestTargets(game, request.category, request.method, location);
    setRequest(current => ({ ...current, game, location, pokemon: nextTargets.some(item => item.species === current.pokemon) ? current.pokemon : nextTargets[0]?.species || 'Bulbasaur' }));
    setResult(null); setError(''); setNotice('');
  };
  const changeCategory = (category: string) => {
    const nextLocations = requestLocations(request.game, category, request.method);
    const location = wildMethod(request.method) ? nextLocations[0] || '' : '';
    const nextTargets = requestTargets(request.game, category, request.method, location);
    setRequest(current => ({ ...current, category, location, pokemon: nextTargets[0]?.species || 'Bulbasaur' }));
    setResult(null); setError(''); setNotice('');
  };
  const changeMethod = (method: string) => {
    if (wildMethod(method) === wildMethod(request.method)) {
      update('method', method as FrlgStaticRequest['method']);
      return;
    }
    const nextCategory = wildMethod(method) ? FRLG_WILD_CATEGORIES[0] : FRLG_STATIC_CATEGORIES[0];
    const nextLocations = requestLocations(request.game, nextCategory, method);
    const location = wildMethod(method) ? nextLocations[0] || '' : '';
    const nextTargets = requestTargets(request.game, nextCategory, method, location);
    setRequest(current => ({ ...current, method: method as FrlgStaticRequest['method'], category: nextCategory, location, pokemon: nextTargets[0]?.species || 'Bulbasaur' }));
    setResult(null); setError(''); setNotice('');
  };
  const changeLocation = (location: string) => {
    const nextTargets = requestTargets(request.game, request.category, request.method, location);
    setRequest(current => ({ ...current, location, pokemon: nextTargets.some(item => item.species === current.pokemon) ? current.pokemon : nextTargets[0]?.species || '' }));
    setResult(null); setError(''); setNotice('');
  };
  const validate = async () => {
    setError(''); setNotice('');
    if (diagnostics.length) { setError(diagnostics[0]); return; }
    const api = window.desktop?.frlgRng;
    if (!api) { setError('请在桌面应用中使用火叶 RNG 服务。'); return; }
    try { await api.validate(toFrlgPlannerPayload(request)); setNotice('参数校验通过，可以搜索方案。'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const search = async () => {
    setError(''); setNotice(''); setResult(null);
    if (diagnostics.length) { setError(diagnostics[0]); return; }
    const api = window.desktop?.frlgRng;
    if (!api) { setError('请在桌面应用中使用火叶 RNG 服务。'); return; }
    setBusy(true);
    pendingSearch.current = true;
    const generation = ++searchGeneration.current;
    try {
      await api.validate(toFrlgPlannerPayload(request));
      if (generation !== searchGeneration.current) return;
      const plan = await api.search(toFrlgPlannerPayload(request));
      if (generation === searchGeneration.current) setResult(plan);
    } catch (reason) { if (generation === searchGeneration.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (generation === searchGeneration.current) { pendingSearch.current = false; setBusy(false); } }
  };
  const cancelSearch = async () => {
    searchGeneration.current += 1;
    pendingSearch.current = false;
    try { await window.desktop?.frlgRng?.cancel(); }
    finally { setBusy(false); setNotice('已取消 FRLG 方案搜索。'); }
  };
  const setIv = (index: number, kind: 'ivMin' | 'ivMax', raw: string) => {
    const values = [...request[kind]];
    values[index] = raw === '' ? 0 : Number(raw);
    update(kind, values);
  };
  const abilityOptions = useMemo(() => getFrlgAbilities(request.pokemon), [request.pokemon]);
  useEffect(() => {
    if (request.ability !== 'Any' && !abilityOptions.some(option => option.english === request.ability)) {
      setRequest(current => ({ ...current, ability: 'Any' }));
    }
  }, [abilityOptions, request.ability]);
  return <section className="automation-workspace frlg-automation-workspace" aria-label="火叶自动流程工作区">
    <header className="automation-heading frlg-automation-heading">
      <div><h2>火叶自动流程</h2><p>搜索定点与野生目标，查看具体个体和初始 Seed 方案。</p></div>
      <span className="frlg-source-badge">FRLG · 方案搜索</span>
    </header>
    <div className="automation-toolbar automation-run-toolbar frlg-run-toolbar">
      <button type="button" className="button primary" disabled={busy || diagnostics.length > 0} onClick={() => void search()}><Play size={14} />{busy ? '搜索中…' : '搜索并生成方案'}</button>
      <button type="button" disabled={!busy} onClick={() => void cancelSearch()}><Square size={14} />停止</button>
      <button type="button" disabled={busy} onClick={() => void validate()}><ListChecks size={14} />参数检查</button>
      <button type="button" disabled title="尚未生成运行脚本；设备与脚本预检接入后启用"><Play size={14} />开始运行</button>
      <span className="frlg-save-status" role="status">{busy ? '正在搜索方案' : result ? '搜索完成' : '待命'}</span>
    </div>
    {(error || notice) && <p role={error ? 'alert' : 'status'} className={error ? 'panel-error' : 'automation-notice'}>{error || notice}</p>}
    <div className="automation-overview frlg-overview">
      <FrlgTargetCard request={request} target={target} locked={busy} onSettings={() => setTargetSettingsOpen(true)} />
      {result ? <FrlgPlanSummary plan={result} onDetails={() => setResultDetailOpen(true)} /> :
        <section className="automation-status-card frlg-status-card" data-status={busy ? 'running' : error ? 'failed' : 'idle'} aria-label="火叶方案状态">
          <div className="automation-status-heading"><span>推荐方案</span><span className="automation-status-label">{busy ? '搜索中' : error ? '需要检查' : '待命'}</span></div>
          <strong role="status">{error || (busy ? '正在搜索符合条件的目标' : '设置目标后开始搜索')}</strong>
          <p className="muted">搜索完成后，这里将显示推荐的宝可梦个体、Seed 和 Advance。</p>
        </section>}
    </div>
    <section className="automation-card automation-feature-card frlg-base-card" aria-label="火叶自动流程参数">
      <div className="automation-feature-heading"><strong>基础设置</strong><span className="automation-feature-status">必选</span></div>
      <fieldset disabled={busy} className="automation-feature-body">
        <div className="automation-fields frlg-base-fields">
          <label>TID<input aria-label="TID" type="number" min={0} max={65535} value={request.tid} onChange={event => update('tid', Number(event.target.value))} /></label>
          <label>SID<input aria-label="SID" type="number" min={0} max={65535} value={request.sid} onChange={event => update('sid', Number(event.target.value))} /></label>
          <label>最小 Advance<input aria-label="最小 Advance" type="number" min={0} value={request.minAdvances} onChange={event => update('minAdvances', Number(event.target.value))} /></label>
          <label>最大 Advance<input aria-label="最大 Advance" type="number" min={0} value={request.maxAdvances} onChange={event => update('maxAdvances', Number(event.target.value))} /></label>
          <label>Seed 模式<select aria-label="Seed 模式" value={request.seedMode === null ? 'auto' : String(request.seedMode)} onChange={event => update('seedMode', event.target.value === 'auto' ? null : Number(event.target.value))}><option value="auto">自动选择</option>{Array.from({ length: 10 }, (_, mode) => <option key={mode} value={mode}>模式 {mode}</option>)}</select></label>
        </div>
        <details className="automation-subsection"><summary>高级设置 · 指定 Seed、搜索工作量</summary>
          <div className="automation-fields frlg-advanced-fields">
            <label className="frlg-checkbox-field"><span>指定 Seed / Advance</span><input aria-label="指定 Seed / Advance" type="checkbox" checked={request.directMode} onChange={event => update('directMode', event.target.checked)} /></label>
            {request.directMode && <label>指定 Seed<input aria-label="指定 Seed" inputMode="text" value={request.directSeed} placeholder="0000-FFFF" onChange={event => update('directSeed', event.target.value)} /></label>}
            {request.directMode && <label>指定 Advance<input aria-label="指定 Advance" type="number" min={0} value={request.directAdvances ?? ''} onChange={event => update('directAdvances', event.target.value === '' ? null : Number(event.target.value))} /></label>}
            <label>初始 Seed 候选数<input aria-label="初始 Seed 候选数" type="number" min={1} value={request.initialSeedResultCount} onChange={event => update('initialSeedResultCount', Number(event.target.value))} /></label>
            <label>搜索工作量上限<input aria-label="搜索工作量上限" type="number" min={1} value={request.maxIvCombinations} onChange={event => update('maxIvCombinations', Number(event.target.value))} /></label>
          </div>
        </details>
      </fieldset>
    </section>
    {targetSettingsOpen && <Dialog title="火叶目标与筛选条件" close={() => setTargetSettingsOpen(false)} className="automation-target-dialog frlg-target-dialog">
      <div className="automation-target-dialog-body">
        <section className="frlg-dialog-section"><h3>目标</h3><div className="automation-fields frlg-fields">
          <label>游戏版本<select aria-label="游戏版本" value={request.game} disabled={busy} onChange={event => changeGame(event.target.value)}>{FRLG_GAMES.map(game => <option key={game} value={game}>{gameLabels[game]}</option>)}</select></label>
          <label>搜索方法<select aria-label="搜索方法" value={request.method} disabled={busy} onChange={event => changeMethod(event.target.value)}>{FRLG_METHODS.map(method => <option key={method} value={method}>{methodLabels[method]}</option>)}</select></label>
          <label>{wildMethod(request.method) ? '遭遇类别' : '分类'}<select aria-label={wildMethod(request.method) ? '野生遭遇类别' : '静态分类'} value={request.category} disabled={busy} onChange={event => changeCategory(event.target.value)}>{(wildMethod(request.method) ? FRLG_WILD_CATEGORIES : FRLG_STATIC_CATEGORIES).map(category => <option key={category} value={category}>{categoryLabels[category]}</option>)}</select></label>
          {wildMethod(request.method) && <label>遭遇地点<select aria-label="野生遭遇地点" value={request.location} disabled={busy} onChange={event => changeLocation(event.target.value)}>{locations.map(location => <option key={location} value={location}>{getFrlgLocationLabel(location)}</option>)}</select></label>}
          <label>目标宝可梦<select aria-label="火叶自动目标宝可梦" value={request.pokemon} disabled={busy} onChange={event => update('pokemon', event.target.value)}>{targets.map(item => <option key={item.species} value={item.species}>{item.displayName} · {item.species}</option>)}</select></label>
        </div></section>
        <details open><summary>目标条件</summary><div className="automation-fields frlg-fields">
          <label>闪光<select aria-label="闪光筛选" value={request.shiny} disabled={busy} onChange={event => update('shiny', event.target.value as FrlgStaticRequest['shiny'])}><option value="Any">任意</option>{FRLG_SHININESS.map(value => <option key={value} value={value}>{shinyLabels[value]}</option>)}</select></label>
          <label>性格<select aria-label="性格筛选" value={request.nature} disabled={busy} onChange={event => update('nature', event.target.value as FrlgStaticRequest['nature'])}><option value="Any">任意</option>{FRLG_NATURES.map(value => <option key={value} value={value}>{natureLabels[value] || value}</option>)}</select></label>
          <label>性别<select aria-label="性别筛选" value={request.gender} disabled={busy} onChange={event => update('gender', event.target.value as FrlgStaticRequest['gender'])}><option value="Any">任意</option><option value="M">雄性</option><option value="F">雌性</option><option value="-">无性别</option></select></label>
          <label>特性<select aria-label="特性筛选" value={request.ability} disabled={busy} onChange={event => update('ability', event.target.value)}><option value="Any">任意</option>{abilityOptions.map(option => <option key={option.english} value={option.english}>{option.displayName} · {option.english}</option>)}</select></label>
          <label>隐藏属性<select aria-label="隐藏属性筛选" value={request.hiddenType} disabled={busy} onChange={event => update('hiddenType', event.target.value as FrlgStaticRequest['hiddenType'])}><option value="Any">任意</option>{FRLG_HIDDEN_TYPES.map(value => <option key={value} value={value}>{typeLabels[value] || value}</option>)}</select></label>
        </div><div className="automation-ivs frlg-ivs">{statLabels.map((label, index) => <label key={label}>{label}<input aria-label={`${label}最小IV`} type="number" min={0} max={31} value={request.ivMin[index]} disabled={busy} onChange={event => setIv(index, 'ivMin', event.target.value)} /><input aria-label={`${label}最大IV`} type="number" min={0} max={31} value={request.ivMax[index]} disabled={busy} onChange={event => setIv(index, 'ivMax', event.target.value)} /></label>)}</div></details>
        {diagnostics.length > 0 && <p className="panel-error" role="alert">{diagnostics[0]}</p>}
      </div>
      <div className="automation-target-dialog-actions"><span className="muted">{diagnostics.length ? '参数待检查' : '目标条件已更新'}</span><button type="button" className="button primary" onClick={() => setTargetSettingsOpen(false)}>完成设置</button></div>
    </Dialog>}
    {resultDetailOpen && result && <FrlgPlanDetails plan={result} close={() => setResultDetailOpen(false)} />}
  </section>;
}
