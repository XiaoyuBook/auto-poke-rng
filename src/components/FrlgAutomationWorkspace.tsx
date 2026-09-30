import { useEffect, useMemo, useState } from 'react';
import { FileClock, ListChecks, Play, SlidersHorizontal, Sparkles, Square } from 'lucide-react';
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
  toFrlgPlannerPayload,
  validateFrlgStaticRequest,
  type FrlgStaticRequest,
  type FrlgStaticTarget,
  type FrlgWildTarget,
} from '../frlgAutomation';
import { Dialog } from './Dialog';
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
const natureLabels: Record<string, string> = {
  Hardy: '勤奋', Lonely: '怕寂寞', Brave: '勇敢', Adamant: '固执', Naughty: '顽皮', Bold: '大胆', Docile: '坦率', Relaxed: '悠闲', Impish: '淘气', Lax: '乐天',
  Timid: '胆小', Hasty: '急躁', Serious: '认真', Jolly: '爽朗', Naive: '天真', Modest: '内敛', Mild: '温和', Quiet: '冷静', Bashful: '害羞', Rash: '马虎',
  Calm: '温和', Gentle: '温顺', Sassy: '自大', Careful: '慎重', Quirky: '浮躁',
};
const shinyLabels: Record<string, string> = { None: '非闪光', Star: '星形闪光', Square: '方形闪光', 'Star/Square': '星形／方形闪光' };

type PlanResult = Record<string, any>;
type FrlgTarget = FrlgStaticTarget | FrlgWildTarget;

const rangeText = (min: number, max: number) => min === max ? String(min) : `${min}–${max}`;

function targetTerms(request: FrlgStaticRequest) {
  const terms: { text: string; shiny?: boolean }[] = [];
  if (request.shiny !== 'Any') terms.push({ text: shinyLabels[request.shiny] || request.shiny, shiny: true });
  if (request.nature !== 'Any') terms.push({ text: `性格 ${natureLabels[request.nature] || request.nature}` });
  if (request.gender !== 'Any') terms.push({ text: `性别 ${request.gender === 'M' ? '雄性' : request.gender === 'F' ? '雌性' : '无性别'}` });
  if (request.ability !== 'Any') terms.push({ text: `特性 ${request.ability}` });
  if (request.hiddenType !== 'Any') terms.push({ text: `隐藏属性 ${request.hiddenType}` });
  request.ivMin.forEach((min, index) => {
    const max = request.ivMax[index];
    if (min !== 0 || max !== 31) terms.push({ text: `${statLabels[index]} ${rangeText(min, max)}` });
  });
  return terms.length ? terms : [{ text: '不限条件' }];
}

const wildMethod = (method: string) => method.includes('Wild');
const targetDisplayName = (target: FrlgTarget | undefined, species: string) => target?.displayName || species;
const ivValues = (ivs: Record<string, number> | undefined) => ivs ? [ivs.hp, ivs.attack, ivs.defense, ivs.sp_attack, ivs.sp_defense, ivs.speed] : [];
const ivText = (ivs: Record<string, number> | undefined) => ivValues(ivs).length === 6 ? ivValues(ivs).join(' / ') : '—';
const genderText = (gender: string | undefined) => gender === 'M' ? '雄性' : gender === 'F' ? '雌性' : gender === '-' ? '无性别' : gender || '—';

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
      <span className="frlg-target-emblem" aria-hidden="true">★</span>
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
  const requestTargets = (game: string, category: string, method: string, location: string): FrlgTarget[] => wildMethod(method)
    ? getFrlgWildTargets(game, category as typeof FRLG_WILD_CATEGORIES[number], location)
    : getFrlgStaticTargets(game, category as typeof FRLG_STATIC_CATEGORIES[number]);
  const requestLocations = (game: string, category: string, method: string) => wildMethod(method) ? getFrlgWildLocations(game, category) : [];
  useEffect(() => {
    if (!profile) return;
    setRequest(current => {
      const locations = requestLocations(profile.game, current.category, current.method);
      const location = wildMethod(current.method) && !locations.includes(current.location) ? locations[0] || '' : current.location;
      const nextTargets = requestTargets(profile.game, current.category, current.method, location);
      const pokemon = nextTargets.some(item => item.species === current.pokemon) ? current.pokemon : nextTargets[0]?.species || 'Bulbasaur';
      return { ...current, game: profile.game, tid: profile.tid, sid: profile.sid, location, pokemon };
    });
  }, [profile]);
  const locations = useMemo(() => requestLocations(request.game, request.category, request.method), [request.game, request.category, request.method]);
  const targets = useMemo(() => requestTargets(request.game, request.category, request.method, request.location), [request.game, request.category, request.method, request.location]);
  const target = targets.find(item => item.species === request.pokemon) || targets[0];
  const diagnostics = validateFrlgStaticRequest(request);
  const update = <K extends keyof FrlgStaticRequest>(key: K, value: FrlgStaticRequest[K]) => {
    setResult(null); setError(''); setNotice(''); setRequest(current => ({ ...current, [key]: value }));
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
    try {
      await api.validate(toFrlgPlannerPayload(request));
      setResult(await api.search(toFrlgPlannerPayload(request)));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const cancelSearch = async () => {
    try { await window.desktop?.frlgRng?.cancel(); }
    finally { setBusy(false); setNotice('已取消 FRLG 方案搜索。'); }
  };
  const setIv = (index: number, kind: 'ivMin' | 'ivMax', raw: string) => {
    const values = [...request[kind]];
    values[index] = raw === '' ? 0 : Number(raw);
    update(kind, values);
  };
  const plan = result?.plan;
  const support = plan?.route_support;
  const summary = result?.search_summary;
  return <section className="automation-workspace frlg-automation-workspace" aria-label="火叶自动流程工作区">
    <header className="automation-heading frlg-automation-heading">
      <div><h2>火叶自动流程</h2><p>第三世代 FRLG 定点与野生乱数；复用公共伊机控、视频源、OCR、通知和日志服务。</p></div>
      <span className="frlg-source-badge">FRLG · 原生伊机控</span>
    </header>
    <div className="automation-toolbar automation-run-toolbar frlg-run-toolbar">
      <button type="button" className="button primary" disabled={busy || diagnostics.length > 0} onClick={() => void search()}><Play size={14} />{busy ? '搜索中…' : '搜索并生成方案'}</button>
      <button type="button" disabled={!busy} onClick={() => void cancelSearch()}><Square size={14} />停止</button>
      <button type="button" disabled={busy} onClick={() => void validate()}><ListChecks size={14} />开始前检查</button>
      <button type="button" disabled={!result || busy} title="完整 FRLG 原生脚本包接入后启用"><Play size={14} />开始运行</button>
      <span className="frlg-save-status" role="status">{busy ? '正在搜索方案' : result ? '搜索完成' : '待命'}</span>
    </div>
    {(error || notice) && <p role={error ? 'alert' : 'status'} className={error ? 'panel-error' : 'automation-notice'}>{error || notice}</p>}
    <div className="automation-overview frlg-overview">
      <FrlgTargetCard request={request} target={target} locked={busy} onSettings={() => setTargetSettingsOpen(true)} />
      <section className="automation-status-card frlg-status-card" data-status={busy ? 'running' : error ? 'failed' : result ? 'completed' : 'idle'} aria-label="火叶方案状态">
        <div className="automation-status-heading"><span>当前流程状态</span><span className="automation-status-label">{busy ? '搜索中' : error ? '需要检查' : result ? '方案已生成' : '待命'}</span></div>
        <strong role="status">{error || (result ? support?.summary || '已返回原版 planner 结果。' : '设置目标后开始搜索')}</strong>
        {result ? <dl><div><dt>匹配目标</dt><dd>{summary?.matching_outcomes ?? 0}</dd></div><div><dt>可达目标</dt><dd>{summary?.reachable_outcomes ?? 0}</dd></div><div><dt>可执行路线</dt><dd>{summary?.feasible_routes ?? 0}</dd></div></dl> : <p className="muted">搜索后会在下方显示 planner 选中的具体目标和执行参数。</p>}
        {result && <button type="button" className="frlg-result-detail" onClick={() => setResultDetailOpen(true)}><FileClock size={13} />查看目标与结果参数</button>}
      </section>
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
    {result && <section className="frlg-recommendation-card" aria-label="火叶推荐方案">
      <header className="frlg-recommendation-heading"><div><h3>推荐方案</h3><p>生成后在这里查看目标与关键参数。</p></div><span className="frlg-plan-badge">{support?.can_start === false ? '仅生成计划' : '预检通过'}</span></header>
      <div className="frlg-recommendation-main">
        <span className="frlg-recommendation-emblem" aria-hidden="true">★</span>
        <div className="frlg-recommendation-identity"><strong>{targetDisplayName(target, plan?.target?.pokemon || plan?.request?.pokemon || request.pokemon)}</strong><small>{plan?.request?.location ? getFrlgLocationLabel(plan.request.location) : target && 'location' in target ? getFrlgLocationLabel(target.location) : categoryLabels[plan?.request?.category || request.category] || request.category} · LV {plan?.target?.level ?? '—'}</small><small>{categoryLabels[plan?.request?.category || request.category] || request.category} · {methodLabels[plan?.target?.method || plan?.request?.method || request.method] || plan?.target?.method || request.method}</small></div>
      </div>
      <div className="frlg-recommendation-metrics"><div><strong>{plan?.initial_seed?.seed || '—'}</strong><span>Seed</span></div><div><strong>{plan?.initial_seed?.advances ?? '—'}</strong><span>Advance</span></div><div><strong>{plan?.selection?.iv_total ?? '—'}</strong><span>个体合计</span></div></div>
      <p className="frlg-recommendation-ivs">IV {ivText(plan?.target?.ivs)}</p>
      <p className="frlg-recommendation-attributes">{natureLabels[plan?.target?.nature] || plan?.target?.nature || '—'} · {plan?.target?.ability && plan.target.ability !== 'Any' ? `特性 ${plan.target.ability}` : '特性不限'} · {genderText(plan?.target?.gender)}</p>
      <button type="button" className="frlg-recommendation-detail" onClick={() => setResultDetailOpen(true)}>查看方案与预检详情</button>
      {Array.isArray(plan?.warnings) && plan.warnings.length > 0 && <ul className="frlg-warnings">{plan.warnings.map((warning: string) => <li key={warning}>{warning}</li>)}</ul>}
    </section>}
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
          <label>特性<select aria-label="特性筛选" value={request.ability} disabled={busy} onChange={event => update('ability', event.target.value)}><option value="Any">任意</option><option value="0">特性 0</option><option value="1">特性 1</option></select></label>
          <label>隐藏属性<select aria-label="隐藏属性筛选" value={request.hiddenType} disabled={busy} onChange={event => update('hiddenType', event.target.value as FrlgStaticRequest['hiddenType'])}><option value="Any">任意</option>{FRLG_HIDDEN_TYPES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        </div><div className="automation-ivs frlg-ivs">{statLabels.map((label, index) => <label key={label}>{label}<input aria-label={`${label}最小IV`} type="number" min={0} max={31} value={request.ivMin[index]} disabled={busy} onChange={event => setIv(index, 'ivMin', event.target.value)} /><input aria-label={`${label}最大IV`} type="number" min={0} max={31} value={request.ivMax[index]} disabled={busy} onChange={event => setIv(index, 'ivMax', event.target.value)} /></label>)}</div></details>
        {diagnostics.length > 0 && <p className="panel-error" role="alert">{diagnostics[0]}</p>}
      </div>
      <div className="automation-target-dialog-actions"><span className="muted">{diagnostics.length ? '参数待检查' : '目标条件已更新'}</span><button type="button" className="button primary" onClick={() => setTargetSettingsOpen(false)}>完成设置</button></div>
    </Dialog>}
    {resultDetailOpen && result && <Dialog title="火叶推荐方案详情" close={() => setResultDetailOpen(false)} className="automation-target-dialog frlg-target-dialog">
      <div className="automation-target-dialog-body frlg-result-body">
        <section className="frlg-dialog-section"><h3>具体目标</h3><dl className="automation-metrics"><div><dt>宝可梦</dt><dd>{targetDisplayName(target, plan?.target?.pokemon || request.pokemon)}</dd></div><div><dt>地点</dt><dd>{plan?.request?.location ? getFrlgLocationLabel(plan.request.location) : '定点目标'}</dd></div><div><dt>等级</dt><dd>{plan?.target?.level ?? '—'}</dd></div><div><dt>PID</dt><dd>{plan?.target?.pid || '—'}</dd></div><div><dt>闪光</dt><dd>{shinyLabels[plan?.target?.shiny] || plan?.target?.shiny || '—'}</dd></div><div><dt>性格</dt><dd>{natureLabels[plan?.target?.nature] || plan?.target?.nature || '—'}</dd></div><div><dt>特性</dt><dd>{plan?.target?.ability || '—'}</dd></div><div><dt>性别</dt><dd>{genderText(plan?.target?.gender)}</dd></div><div><dt>隐藏属性</dt><dd>{plan?.target?.hidden_type || '—'}</dd></div><div><dt>IV</dt><dd>{ivText(plan?.target?.ivs)}</dd></div></dl></section>
        <section className="frlg-dialog-section"><h3>执行参数</h3><dl className="automation-metrics"><div><dt>目标 Seed</dt><dd>{plan?.target?.target_seed || '—'}</dd></div><div><dt>初始 Seed</dt><dd>{plan?.initial_seed?.seed || '—'}</dd></div><div><dt>Advance</dt><dd>{plan?.initial_seed?.advances ?? '—'}</dd></div><div><dt>Seed 模式</dt><dd>{plan?.execution?.seed_mode ?? '—'}</dd></div><div><dt>总等待</dt><dd>{plan?.initial_seed?.total_time || '—'}</dd></div><div><dt>路线状态</dt><dd className={plan?.route_support?.can_start ? 'frlg-support-ok' : ''}>{plan?.route_support?.summary || '—'}</dd></div></dl></section>
      </div>
      <div className="automation-target-dialog-actions"><span className="muted">匹配 {summary?.matching_outcomes ?? 0} · 可达 {summary?.reachable_outcomes ?? 0} · 路线 {summary?.feasible_routes ?? 0}</span><button type="button" className="button primary" onClick={() => setResultDetailOpen(false)}>关闭</button></div>
    </Dialog>}
  </section>;
}
