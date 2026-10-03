import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, SlidersHorizontal, Sparkles, Square } from 'lucide-react';
import type { FrlgTargetIntent } from '../frlgDex';
import {
  FRLG_WILD_CATEGORIES,
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
import { FrlgTargetSettingsDialog } from './FrlgTargetSettingsDialog';
import { FrlgPlanSummary, FrlgPlanDetails } from './FrlgPlanResult';
import { FrlgSprite } from './FrlgSprite';
import { abilityLabels, categoryLabels, gameLabels, methodLabels, natureLabels, shinyLabels, statLabels, typeLabels } from '../frlgLabels';
import { defaultFrlgSaveProfile, type FrlgSaveProfile } from '../frlgProfile';
import { frlgRunBusy, loadFrlgRunOptions, type FrlgRunOptions, type FrlgRunState } from '../frlgExecution';
import { FrlgRunSettings } from './FrlgRunSettings';
import { FrlgBingoBoard } from './FrlgBingoBoard';

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
    <button type="button" className="automation-target-main frlg-target-open" disabled={locked} onClick={onSettings} aria-label="选择火叶目标">
      <span className="frlg-target-emblem"><FrlgSprite species={request.pokemon} /></span>
      <div className="automation-target-identity">
        <strong>{target?.displayName || request.pokemon}</strong>
        <small>{target?.species || request.pokemon} · {gameLabels[request.game] || request.game}</small>
        <small>{categoryLabels[request.category] || request.category} · {methodLabels[request.method] || request.method}{target && 'location' in target ? ` · ${getFrlgLocationLabel(target.location)}` : ''}</small>
      </div>
    </button>
    <div className="automation-target-conditions">
      <div className="automation-target-conditions-heading"><span>目标条件 <b>{terms.length} 项</b></span><small>同组条件同时满足</small></div>
      <ul className="automation-target-condition-list">{terms.slice(0, 4).map((term, index) => <li key={`${term.text}-${index}`}><div className="automation-target-condition-terms">{term.shiny ? <span className="automation-target-shiny-term"><Sparkles size={12} aria-hidden="true" />{term.text}</span> : <span>{term.text}</span>}</div></li>)}</ul>
      {terms.length > 4 && <button type="button" className="automation-target-more" onClick={onSettings}>查看全部 {terms.length} 项条件</button>}
    </div>
  </section>;
}

export function FrlgAutomationWorkspace({ profile = defaultFrlgSaveProfile, onOpenLogs, targetIntent, onTargetConsumed }: { profile?: FrlgSaveProfile; onOpenLogs?: () => void; targetIntent?: FrlgTargetIntent | null; onTargetConsumed?: () => void }) {
  const [request, setRequest] = useState<FrlgStaticRequest>(() => {
    const base = defaultFrlgStaticRequest();
    return { ...base, game: profile.game, tid: profile.tid, sid: profile.sid };
  });
  const [result, setResult] = useState<PlanResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const profileId = profile.id;
  const [run, setRun] = useState<FrlgRunState | null>(null);
  const [options, setOptions] = useState<FrlgRunOptions>(() => loadFrlgRunOptions(profileId));
  const running = frlgRunBusy(run);
  const locked = busy || running;
  const bingoRun = run?.profileId === profileId ? run : null;
  useEffect(() => { setOptions(loadFrlgRunOptions(profileId)); }, [profileId]);
  useEffect(() => {
    const api = window.desktop?.frlgAutomation;
    if (!api) return;
    let alive = true;
    void api.getState().then(value => { if (alive) setRun(value); }).catch(() => {});
    const unsubscribe = api.onState(setRun);
    return () => { alive = false; unsubscribe(); };
  }, []);
  const saveOptions = (value: FrlgRunOptions) => {
    setOptions(value);
    localStorage.setItem('auto-poke-frlg-run:' + profileId, JSON.stringify(value));
  };
  const startRun = async () => {
    if (!result || locked) return;
    setError('');
    try {
      const api = window.desktop?.frlgAutomation;
      if (!api) throw Error('请在桌面应用中运行火叶流程');
      setRun(await api.start({ request: result.request, profileId, options: { ...options, item_rng_mode: wildMethod(request.method) && !!options.item_rng_mode } }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const stopRun = async () => {
    try { const value = await window.desktop?.frlgAutomation?.stop(); if (value) setRun(value); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
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
    invalidate();
    setRequest(current => {
      const locations = requestLocations(profile.game, current.category, current.method);
      const location = wildMethod(current.method) && !locations.includes(current.location) ? locations[0] || '' : current.location;
      const nextTargets = requestTargets(profile.game, current.category, current.method, location);
      const pokemon = nextTargets.some(item => item.species === current.pokemon) ? current.pokemon : nextTargets[0]?.species || 'Bulbasaur';
      return { ...current, game: profile.game, tid: profile.tid, sid: profile.sid, location, pokemon };
    });
  }, [profile.id, profile.game, profile.tid, profile.sid]);
  useEffect(() => {
    if (!targetIntent) return;
    if (targetIntent.profileId !== profile.id) { onTargetConsumed?.(); return; }
    let alive = true;
    void (window.desktop?.frlgAutomation?.getState() || Promise.resolve(run)).then(latest => {
      if (!alive) return;
      if (locked || frlgRunBusy(latest) || pendingSearch.current) {
        setNotice('当前流程正在执行，请结束运行或搜索后再更换图鉴目标。');
      } else {
        invalidate();
        setRequest({ ...defaultFrlgStaticRequest(), ...targetIntent.route, game: profile.game, tid: profile.tid, sid: profile.sid });
        setTargetSettingsOpen(true);
      }
      onTargetConsumed?.();
    }).catch(reason => { if (alive) { setError(reason instanceof Error ? reason.message : String(reason)); onTargetConsumed?.(); } });
    return () => { alive = false; };
  }, [targetIntent, profile.id, profile.game, profile.tid, profile.sid, locked]);
  const locations = useMemo(() => requestLocations(request.game, request.category, request.method), [request.game, request.category, request.method]);
  const targets = useMemo(() => requestTargets(request.game, request.category, request.method, request.location), [request.game, request.category, request.method, request.location]);
  const target = targets.find(item => item.species === request.pokemon) || targets[0];
  const diagnostics = validateFrlgStaticRequest(request);
  const update = <K extends keyof FrlgStaticRequest>(key: K, value: FrlgStaticRequest[K]) => {
    invalidate(); setRequest(current => ({ ...current, [key]: value }));
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
  const search = async () => {
    if (locked) return;
    setError(''); setNotice(''); setResult(null);
    if (diagnostics.length) { setError(diagnostics[0]); return; }
    const api = window.desktop?.frlgRng;
    if (!api) { setError('请在桌面应用中使用火叶 RNG 服务。'); return; }
    setBusy(true);
    pendingSearch.current = true;
    const generation = ++searchGeneration.current;
    try {
      const payload = toFrlgPlannerPayload({ ...request, game: profile.game, tid: profile.tid, sid: profile.sid });
      await api.validate(payload);
      if (generation !== searchGeneration.current) return;
      const plan = await api.search(payload);
      if (generation === searchGeneration.current) { setResult(plan); setTargetSettingsOpen(false); }
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
  const openRunLogs = () => {
    if (run?.runId) {
      localStorage.setItem('auto-poke-rng:log-context', JSON.stringify({ runId: run.runId }));
      window.dispatchEvent(new Event('auto-poke:related-logs'));
    }
    onOpenLogs?.();
  };
  const progressLabel = (progress: FrlgRunState['progress']) => {
    const action = progress?.action || progress?.source || '';
    if (/^(shutdown\.|egg\.restart\.)/.test(action)) return '正在准备游戏环境';
    if (/^(main\.home_buffer|sid\.home_buffer)/.test(action)) return '正在校准主页缓冲';
    if (/^settings\./.test(action)) return '正在检查游戏设置';
    if (/^capture\.(wait_ready|ball_result)/.test(action)) return '正在读取捕获结果';
    if (/^wild\.data\./.test(action)) return '正在识别野生个体信息';
    return action || '正在执行火叶流程';
  };
  useEffect(() => {
    if (request.ability !== 'Any' && !abilityOptions.some(option => option.english === request.ability)) {
      setRequest(current => ({ ...current, ability: 'Any' }));
    }
  }, [abilityOptions, request.ability]);
  return <section className="automation-workspace frlg-automation-workspace" aria-label="火叶自动流程工作区">
    <header className="automation-heading frlg-automation-heading">
      <div><h2>火叶自动流程</h2><p>搜索目标，执行捕获、反查校准与自动重试。</p></div>
    </header>
    <div className="automation-toolbar automation-run-toolbar frlg-run-toolbar">
      <button type="button" className="button primary" disabled={locked || !result?.route_support.can_start} onClick={() => void startRun()}><Play size={14} />开始运行</button>
      <button type="button" disabled={!locked} onClick={() => void (running ? stopRun() : cancelSearch())}><Square size={14} />停止</button>
      <span className="frlg-save-status" role="status">{run && run.status !== 'idle' ? (running && run.progress ? progressLabel(run.progress) : run.message) : busy ? '正在搜索方案' : result ? '搜索完成' : '待命'}</span>
      {run && run.status !== 'idle' && <button type="button" className="text-button" onClick={openRunLogs}>打开日志中心</button>}
    </div>
    {!targetSettingsOpen && (error || notice) && <p role={error ? 'alert' : 'status'} className={error ? 'panel-error' : 'automation-notice'}>{error || notice}</p>}
    <div className="automation-overview frlg-overview">
      <div className="frlg-target-slot">{result ? <FrlgPlanSummary plan={result} compact locked={locked} onSettings={() => setTargetSettingsOpen(true)} onDetails={() => setResultDetailOpen(true)} /> : <><FrlgTargetCard request={request} target={target} locked={locked} onSettings={() => setTargetSettingsOpen(true)} /><p className="frlg-target-search-status" role="status">{busy ? '正在搜索并生成方案…' : '点击目标卡片，设置条件并生成方案'}</p></>}</div>
      <div className="frlg-bingo-card"><FrlgBingoBoard key={`${profileId}:${bingoRun?.runId || 'idle'}`} state={bingoRun?.bingo} compact /></div>
    </div>
    <details className="frlg-run-settings-fold" key={profileId}><summary><strong>运行与反查校准</strong><span>{options.entry === 'timeline' ? '时间轴入口' : '正式入口'} · 设置随存档保存</span></summary><FrlgRunSettings options={options} onChange={saveOptions} locked={locked} wild={wildMethod(request.method)} /></details>
    {targetSettingsOpen && !running && <FrlgTargetSettingsDialog request={request} profile={profile} target={target} targets={targets} locations={locations} abilities={abilityOptions} busy={busy} diagnostics={diagnostics} error={error} notice={notice}
      onChange={update} onMethod={changeMethod} onCategory={changeCategory} onLocation={changeLocation} onIv={setIv}
      onIvPreset={perfect => { invalidate(); setRequest(current => ({ ...current, ivMin: Array(6).fill(perfect ? 31 : 0), ivMax: Array(6).fill(31) })); }}
      onClose={() => setTargetSettingsOpen(false)} onSearch={() => void search()} onCancelSearch={() => void cancelSearch()}/>}
    {resultDetailOpen && result && <FrlgPlanDetails plan={result} close={() => setResultDetailOpen(false)} />}
  </section>;
}
