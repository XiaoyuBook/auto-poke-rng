import { useMemo, useState } from 'react';
import {
  FRLG_GAMES,
  FRLG_HIDDEN_TYPES,
  FRLG_NATURES,
  FRLG_SHININESS,
  FRLG_STATIC_CATEGORIES,
  FRLG_STATIC_METHODS,
  defaultFrlgStaticRequest,
  getFrlgStaticTargets,
  toFrlgPlannerPayload,
  validateFrlgStaticRequest,
  type FrlgStaticRequest,
} from '../frlgAutomation';

const gameLabels: Record<string, string> = {
  fr_nx: '火红 · 美版 · Switch 1', fr_nx2: '火红 · 美版 · Switch 2',
  lg_nx: '叶绿 · 美版 · Switch 1', lg_nx2: '叶绿 · 美版 · Switch 2',
  fr_jpn_nx: '火红 · 日版 · Switch 1', fr_jpn_nx2: '火红 · 日版 · Switch 2',
  lg_jpn_nx: '叶绿 · 日版 · Switch 1', lg_jpn_nx2: '叶绿 · 日版 · Switch 2',
};
const categoryLabels: Record<string, string> = {
  Starter: '御三家', Fossil: '化石', Gift: '赠送', GameCorner: '游戏中心',
  Stationary: '定点', Legend: '传说', Event: '事件', Roaming: '游走',
};
const methodLabels: Record<string, string> = { Static: 'Static', 'Static 1': 'Static 1', 'Static 2': 'Static 2', 'Static 4': 'Static 4' };
const statLabels = ['HP', '攻击', '防御', '特攻', '特防', '速度'];
const natureLabels: Record<string, string> = {
  Hardy: '勤奋', Lonely: '怕寂寞', Brave: '勇敢', Adamant: '固执', Naughty: '顽皮', Bold: '大胆', Docile: '坦率', Relaxed: '悠闲', Impish: '淘气', Lax: '乐天',
  Timid: '胆小', Hasty: '急躁', Serious: '认真', Jolly: '爽朗', Naive: '天真', Modest: '内敛', Mild: '温和', Quiet: '冷静', Bashful: '害羞', Rash: '马虎',
  Calm: '温和', Gentle: '温顺', Sassy: '自大', Careful: '慎重', Quirky: '浮躁',
};

type PlanResult = Record<string, any>;

export function FrlgAutomationWorkspace() {
  const [request, setRequest] = useState<FrlgStaticRequest>(defaultFrlgStaticRequest);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const targets = useMemo(() => getFrlgStaticTargets(request.game, request.category as any), [request.game, request.category]);
  const diagnostics = validateFrlgStaticRequest(request);
  const update = <K extends keyof FrlgStaticRequest>(key: K, value: FrlgStaticRequest[K]) => {
    setResult(null); setError(''); setRequest(current => ({ ...current, [key]: value }));
  };
  const changeGame = (game: string) => {
    const nextTargets = getFrlgStaticTargets(game, request.category as any);
    setRequest(current => ({ ...current, game, pokemon: nextTargets.some(target => target.species === current.pokemon) ? current.pokemon : nextTargets[0]?.species || 'Bulbasaur' }));
    setResult(null); setError('');
  };
  const changeCategory = (category: string) => {
    const nextTargets = getFrlgStaticTargets(request.game, category as any);
    setRequest(current => ({ ...current, category, pokemon: nextTargets[0]?.species || 'Bulbasaur' }));
    setResult(null); setError('');
  };
  const search = async () => {
    setError(''); setResult(null);
    if (diagnostics.length) { setError(diagnostics[0]); return; }
    const api = window.desktop?.frlgRng;
    if (!api) { setError('请在桌面应用中使用火叶 RNG 服务。'); return; }
    setBusy(true);
    try {
      await api.validate(toFrlgPlannerPayload(request));
      setResult(await api.search(toFrlgPlannerPayload(request)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  };
  const cancelSearch = async () => {
    try { await window.desktop?.frlgRng?.cancel(); }
    finally { setBusy(false); setError('已取消 FRLG 方案搜索。'); }
  };
  const setIv = (index: number, kind: 'ivMin' | 'ivMax', raw: string) => {
    const values = [...request[kind]];
    values[index] = raw === '' ? 0 : Number(raw);
    update(kind, values);
  };
  const plan = result?.plan;
  const target = plan?.target;
  const support = plan?.route_support;
  const summary = result?.search_summary;
  return <section className="frlg-automation-workspace" aria-label="火叶自动流程工作区">
    <header className="automation-heading frlg-automation-heading">
      <div><h2>火叶自动流程</h2><p>第三世代 FRLG 静态／定点乱数；使用独立的 Gen 3 planner 和脚本链。</p></div>
      <span className="frlg-source-badge">FRLG · 原生伊机控</span>
    </header>
    <div className="frlg-automation-layout">
      <section className="automation-card frlg-automation-card" aria-label="火叶自动流程参数">
        <div className="automation-card-heading"><strong>基础设置</strong><span>静态／定点</span></div>
        <div className="automation-fields frlg-fields">
          <label>游戏版本<select aria-label="游戏版本" value={request.game} disabled={busy} onChange={event => changeGame(event.target.value)}>{FRLG_GAMES.map(game => <option key={game} value={game}>{gameLabels[game]}</option>)}</select></label>
          <label>TID<input aria-label="TID" type="number" min={0} max={65535} value={request.tid} disabled={busy} onChange={event => update('tid', Number(event.target.value))} /></label>
          <label>SID<input aria-label="SID" type="number" min={0} max={65535} value={request.sid} disabled={busy} onChange={event => update('sid', Number(event.target.value))} /></label>
          <label>方法<select aria-label="静态方法" value={request.method} disabled={busy} onChange={event => update('method', event.target.value as FrlgStaticRequest['method'])}>{FRLG_STATIC_METHODS.map(method => <option key={method} value={method}>{methodLabels[method]}</option>)}</select></label>
        </div>
        <div className="automation-fields frlg-fields">
          <label>分类<select aria-label="静态分类" value={request.category} disabled={busy} onChange={event => changeCategory(event.target.value)}>{FRLG_STATIC_CATEGORIES.map(category => <option key={category} value={category}>{categoryLabels[category]}</option>)}</select></label>
          <label>目标宝可梦<select aria-label="火叶自动定点宝可梦" value={request.pokemon} disabled={busy} onChange={event => update('pokemon', event.target.value)}>{targets.map(item => <option key={item.species} value={item.species}>{item.displayName} · {item.species}</option>)}</select></label>
          <label>最小 Advance<input aria-label="最小 Advance" type="number" min={0} value={request.minAdvances} disabled={busy} onChange={event => update('minAdvances', Number(event.target.value))} /></label>
          <label>最大 Advance<input aria-label="最大 Advance" type="number" min={0} value={request.maxAdvances} disabled={busy} onChange={event => update('maxAdvances', Number(event.target.value))} /></label>
        </div>
        <div className="automation-fields frlg-fields">
          <label>Seed 模式<select aria-label="Seed 模式" value={request.seedMode === null ? 'auto' : String(request.seedMode)} disabled={busy} onChange={event => update('seedMode', event.target.value === 'auto' ? null : Number(event.target.value))}><option value="auto">自动选择</option>{Array.from({ length: 10 }, (_, mode) => <option key={mode} value={mode}>模式 {mode}</option>)}</select></label>
          <label className="frlg-checkbox-field"><span>指定 Seed / Advance</span><input aria-label="指定 Seed / Advance" type="checkbox" checked={request.directMode} disabled={busy} onChange={event => update('directMode', event.target.checked)} /></label>
          {request.directMode && <label>指定 Seed<input aria-label="指定 Seed" inputMode="text" value={request.directSeed} disabled={busy} placeholder="0000-FFFF" onChange={event => update('directSeed', event.target.value)} /></label>}
          {request.directMode && <label>指定 Advance<input aria-label="指定 Advance" type="number" min={0} value={request.directAdvances ?? ''} disabled={busy} onChange={event => update('directAdvances', event.target.value === '' ? null : Number(event.target.value))} /></label>}
        </div>
        <div className="automation-card-heading"><strong>目标筛选</strong><span>与原版 Ten Lines 参数一致</span></div>
        <div className="automation-fields frlg-fields">
          <label>闪光<select aria-label="闪光筛选" value={request.shiny} disabled={busy} onChange={event => update('shiny', event.target.value as FrlgStaticRequest['shiny'])}><option value="Any">任意</option>{FRLG_SHININESS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>性格<select aria-label="性格筛选" value={request.nature} disabled={busy} onChange={event => update('nature', event.target.value as FrlgStaticRequest['nature'])}><option value="Any">任意</option>{FRLG_NATURES.map(value => <option key={value} value={value}>{natureLabels[value] || value}</option>)}</select></label>
          <label>性别<select aria-label="性别筛选" value={request.gender} disabled={busy} onChange={event => update('gender', event.target.value as FrlgStaticRequest['gender'])}><option value="Any">任意</option><option value="M">雄性</option><option value="F">雌性</option><option value="-">无性别</option></select></label>
          <label>特性<select aria-label="特性筛选" value={request.ability} disabled={busy} onChange={event => update('ability', event.target.value)}><option value="Any">任意</option><option value="0">特性 0</option><option value="1">特性 1</option></select></label>
        </div>
        <label className="frlg-wide-field">隐藏属性<select aria-label="隐藏属性筛选" value={request.hiddenType} disabled={busy} onChange={event => update('hiddenType', event.target.value as FrlgStaticRequest['hiddenType'])}><option value="Any">任意</option>{FRLG_HIDDEN_TYPES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <div className="automation-ivs frlg-ivs">{statLabels.map((label, index) => <label key={label}>{label}<input aria-label={`${label}最小IV`} type="number" min={0} max={31} value={request.ivMin[index]} disabled={busy} onChange={event => setIv(index, 'ivMin', event.target.value)} /><input aria-label={`${label}最大IV`} type="number" min={0} max={31} value={request.ivMax[index]} disabled={busy} onChange={event => setIv(index, 'ivMax', event.target.value)} /></label>)}</div>
        <div className="automation-fields frlg-fields frlg-search-limits">
          <label>初始 Seed 候选数<input aria-label="初始 Seed 候选数" type="number" min={1} value={request.initialSeedResultCount} disabled={busy} onChange={event => update('initialSeedResultCount', Number(event.target.value))} /></label>
          <label>搜索工作量上限<input aria-label="搜索工作量上限" type="number" min={1} value={request.maxIvCombinations} disabled={busy} onChange={event => update('maxIvCombinations', Number(event.target.value))} /></label>
        </div>
        {diagnostics.length > 0 && <p className="panel-error" role="alert">{diagnostics[0]}</p>}
        <div className="frlg-actions"><button type="button" className="button primary" disabled={busy || diagnostics.length > 0} onClick={() => void search()}>{busy ? '搜索中…' : '搜索并生成方案'}</button>{busy && <button type="button" className="button" onClick={() => void cancelSearch()}>取消搜索</button>}<button type="button" className="button" disabled={!result || busy} title="完整 FRLG 原生脚本包接入后启用">开始运行</button></div>
        <p className="muted">方案搜索复用原版 FRLG planner；运行阶段将使用现有原生伊机控、视频和脚本宿主，待脚本包完成预检后开放。</p>
      </section>
      <section className="automation-card frlg-result-card" aria-label="火叶方案结果">
        <div className="automation-card-heading"><strong>方案结果</strong><span>{busy ? '搜索中…' : result ? '方案已生成' : '等待搜索'}</span></div>
        {error && <p className="panel-error" role="alert">{error}</p>}
        {!result && !error && <p className="muted">填写目标和筛选条件后，点击“搜索并生成方案”。</p>}
        {result && <div className="frlg-result-body">
          <dl className="automation-metrics"><div><dt>目标</dt><dd>{target?.pokemon || plan?.request?.pokemon || request.pokemon}</dd></div><div><dt>目标性格</dt><dd>{target?.nature || '—'}</dd></div><div><dt>目标闪光</dt><dd>{target?.shiny || '—'}</dd></div><div><dt>Advance</dt><dd>{target?.advances ?? plan?.initial_seed?.advances ?? '—'}</dd></div><div><dt>初始 Seed</dt><dd>{plan?.initial_seed?.seed || '—'}</dd></div><div><dt>Seed 模式</dt><dd>{plan?.execution?.seed_mode ?? '—'}</dd></div><div><dt>总等待</dt><dd>{plan?.initial_seed?.total_time || '—'}</dd></div></dl>
          <p className={support?.can_start ? 'frlg-support-ok' : 'panel-error'}>{support?.summary || '已返回原版 planner 结果。'}</p>
          {summary && <p className="muted">匹配 {summary.matching_outcomes ?? 0} · 可达 {summary.reachable_outcomes ?? 0} · 可执行路线 {summary.feasible_routes ?? 0}</p>}
          {Array.isArray(plan?.warnings) && plan.warnings.length > 0 && <ul className="frlg-warnings">{plan.warnings.map((warning: string) => <li key={warning}>{warning}</li>)}</ul>}
        </div>}
      </section>
    </div>
  </section>;
}
