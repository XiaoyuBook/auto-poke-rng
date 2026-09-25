import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Database, Download, Dices, Filter, RefreshCw, Sparkles } from 'lucide-react';
import { CATEGORY_OPTIONS, NATURES_ZH, getCategoryLabel, getStaticTargets, targetAbilityLabel, targetShinyLabel, type StaticCategoryKey } from '../staticData';
import type { NativeStaticResult, StaticGenerationRequest } from '../desktop';
import type { BdspProfile } from '../bdspProfile';
import { LeadSelector } from './LeadSelector';
import { STATIC_COLUMNS, useStaticColumns } from '../staticTable';
import { StaticTableSettings } from './StaticTableSettings';
import { IvCalculatorDialog } from './IvCalculatorDialog';
import { StaticResultsTable } from './StaticResultsTable';
import { staticResultCells as cells } from '../staticResults';

const statLabels = ['HP', '攻击', '防御', '特攻', '特防', '速度'];
const columns = STATIC_COLUMNS.map(column => column.label);
function csvDownload(rows: NativeStaticResult[], species: string, showStats: boolean) {
  const csv = [columns, ...rows.map(row => cells(row, showStats))].map(line => line.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${species}-定点数据.csv`; anchor.click(); URL.revokeObjectURL(url);
}
function numeric(text: string, label: string, max: number) {
  const value = Number(text);
  if (!text.trim() || !Number.isInteger(value) || value < 0 || value > max) throw new Error(`${label}必须在 0–${max} 之间。`);
  return value;
}

export function StaticDataWorkspace({ profile, onLog }: { profile: BdspProfile; onLog?: (message: string) => void }) {
  const [category, setCategory] = useState<StaticCategoryKey>('starters');
  const [targetKey, setTargetKey] = useState('Turtwig');
  const [seed0, setSeed0] = useState('');
  const [seed1, setSeed1] = useState('');
  const [initialAdvance, setInitialAdvance] = useState('0');
  const [maxAdvances, setMaxAdvances] = useState('100000');
  const [offset, setOffset] = useState('0');
  const [lead, setLead] = useState(255);
  const [nature, setNature] = useState(-1);
  const [shiny, setShiny] = useState(255);
  const [ability, setAbility] = useState(255);
  const [gender, setGender] = useState(255);
  const [ivMin, setIvMin] = useState([0, 0, 0, 0, 0, 0]);
  const [ivMax, setIvMax] = useState([31, 31, 31, 31, 31, 31]);
  const [heightMin, setHeightMin] = useState('0');
  const [heightMax, setHeightMax] = useState('255');
  const [weightMin, setWeightMin] = useState('0');
  const [weightMax, setWeightMax] = useState('255');
  const [skipFilter, setSkipFilter] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [results, setResults] = useState<NativeStaticResult[]>([]);
  const [resultSpecies, setResultSpecies] = useState('');
  const [generating, setGenerating] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [lookupMessage, setLookupMessage] = useState('');
  const [message, setMessage] = useState('尚未生成结果');
  const [error, setError] = useState(false);
  const [tableSettingsOpen, setTableSettingsOpen] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const { hidden, setHidden, visible } = useStaticColumns();
  const seedRef = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  const targetOptions = useMemo(() => getStaticTargets(category, profile.version), [category, profile.version]);
  const target = targetOptions.find(item => item.speciesKey === targetKey) ?? targetOptions[0];
  const selected = selectedIndex === null ? undefined : results[selectedIndex];
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (running.current) void window.desktop?.rng?.cancel().catch(() => {}); };
  }, []);
  const updateRange = (setter: typeof setIvMin, values: number[], index: number, value: string) => setter(values.map((item, itemIndex) => itemIndex === index ? Math.max(0, Math.min(31, Number.parseInt(value, 10) || 0)) : item));
  const generate = async () => {
    if (!target || running.current) return;
    setError(false); setResults([]); setSelectedIndex(null);
    try {
      const engine = window.desktop?.rng;
      if (!engine) throw new Error('请在桌面应用中使用 PokeFinder 原生计算引擎。');
      if (!/^[\da-f]{1,16}$/i.test(seed0) || !/^[\da-f]{1,16}$/i.test(seed1)) throw new Error('Seed 0 与 Seed 1 均需填写 1–16 位十六进制数。');
      if (BigInt(`0x${seed0}`) === 0n && BigInt(`0x${seed1}`) === 0n) throw new Error('Seed 0 与 Seed 1 不能同时为 0。');
      const request: StaticGenerationRequest = {
        seed0, seed1, initialAdvances: numeric(initialAdvance, '初始帧', 10000000), maxAdvances: numeric(maxAdvances, '最大帧数', 1000000000), offset: numeric(offset, 'Offset', 1000000), lead,
        target: target.speciesKey, profile,
        filter: { skip: skipFilter, ability, gender, shiny, heightMin: numeric(heightMin, '身高下限', 255), heightMax: numeric(heightMax, '身高上限', 255), weightMin: numeric(weightMin, '体重下限', 255), weightMax: numeric(weightMax, '体重上限', 255), ivMin, ivMax, natures: NATURES_ZH.map((_, index) => nature < 0 || index === nature) },
      };
      if (ivMin.some((value, index) => value > ivMax[index]) || request.filter.heightMin > request.filter.heightMax || request.filter.weightMin > request.filter.weightMax) throw new Error('筛选下限不能大于上限。');
      running.current = true; setGenerating(true); setMessage('正在调用 PokeFinder 原生引擎…');
      const rows = await engine.staticGenerate(request);
      if (!mounted.current) return;
      setResults(rows); setResultSpecies(target.species); setMessage(rows.length ? '已生成结果' : '没有符合条件的结果');
      onLog?.(`${target.species} · 定点搜索完成，共 ${rows.length} 条。`);
    } catch (reason) {
      if (!mounted.current) return;
      const detail = reason instanceof Error ? reason.message : 'PokeFinder 原生引擎调用失败。';
      setError(!detail.includes('已取消搜索')); setMessage(detail);
    } finally {
      running.current = false;
      if (mounted.current) setGenerating(false);
    }
  };
  const copy = async (rows: NativeStaticResult[], selection = false) => {
    try {
      if (!navigator.clipboard) throw new Error('剪贴板不可用');
      await navigator.clipboard.writeText([...(selection ? [] : [columns.join('\t')]), ...rows.map(row => cells(row, showStats).join('\t'))].join('\n'));
      setMessage(selection ? '已复制选中行' : `已复制 ${rows.length} 条结果`); setError(false);
    } catch { setMessage('复制失败，请重试或导出 CSV。'); setError(true); }
  };

  return <section className="static-workspace" aria-label="定点数据工作区">
    <div className="static-settings-content">
      <header className="static-workspace-heading"><div><Dices size={17} /><div><h2>定点数据</h2><p>使用{profile.version === 'BD' ? '晶灿钻石' : '明亮珍珠'}存档 · TID {profile.tid} / SID {profile.sid}</p></div></div><span className="static-source-badge"><Database size={12} /> PokéFinder · BDSP Static</span></header>
      <section className="static-config-card" aria-label="定点数据参数">
        <div className="static-target-settings" role="group" aria-label="定点设置">
          <div className="static-target-fields">
            <label>分类<select aria-label="分类" title={getCategoryLabel(category)} value={category} onChange={event => setCategory(event.target.value as StaticCategoryKey)}>{CATEGORY_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
            <label>宝可梦<select aria-label="宝可梦" title={target?.species} value={target?.speciesKey ?? ''} onChange={event => setTargetKey(event.target.value)}>{targetOptions.map(item => <option key={item.speciesKey} value={item.speciesKey}>{item.species}{category === 'all' ? ` [${getCategoryLabel(item.category)}]` : ''}{item.roamer ? ' 游走' : ''}</option>)}</select></label>
            <div className="static-lead-field"><span>队首</span><LeadSelector value={lead} onChange={setLead} /></div>
          </div>
          <dl className="static-target-summary" aria-label="目标属性">
            <div><dt>等级</dt><dd aria-label="等级">{target?.level ?? '—'}</dd></div>
            <div><dt>特性</dt><dd aria-label="目标特性">{target ? targetAbilityLabel(target.ability) : '—'}</dd></div>
            <div><dt>异色</dt><dd aria-label="目标异色">{target ? targetShinyLabel(target.shiny) : '—'}</dd></div>
            <div><dt>IV Count</dt><dd aria-label="IV Count">{target?.ivCount ?? '—'}</dd></div>
          </dl>
        </div>
        <div className="static-rng-settings" role="group" aria-label="乱数信息">
          <div className="static-seed-fields">
            <label>Seed 0<input aria-label="Seed 0" value={seed0} onChange={event => setSeed0(event.target.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 16))} ref={seedRef} spellCheck={false} /></label>
            <label>Seed 1<input aria-label="Seed 1" value={seed1} onChange={event => setSeed1(event.target.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 16))} spellCheck={false} /></label>
          </div>
          <div className="static-advance-fields">
            <label>初始帧<input aria-label="初始帧" inputMode="numeric" value={initialAdvance} onChange={event => setInitialAdvance(event.target.value.replace(/\D/g, ''))} /></label>
            <label>最大帧数<input aria-label="最大帧数" title="从初始帧起的追加帧数，含首尾；0 表示仅生成初始帧" inputMode="numeric" value={maxAdvances} onChange={event => setMaxAdvances(event.target.value.replace(/\D/g, ''))} /></label>
            <label>Offset<input aria-label="Offset" inputMode="numeric" value={offset} onChange={event => setOffset(event.target.value.replace(/\D/g, ''))} /></label>
          </div>
        </div>
        <div className="static-filter-settings" role="group" aria-label="筛选项">
          <header><Filter size={13} /><h3>筛选项</h3><button className="static-link-button" type="button" onClick={() => setCalculatorOpen(true)}>个体值计算器</button></header>
          <div className="static-iv-matrix" role="group" aria-label="个体值范围">
            <div className="static-iv-axis"><span>个体值</span><span>下限</span><span>上限</span></div>
            {statLabels.map((label, index) => <div className="static-iv-stat" key={label}><span>{label}</span><input aria-label={`${label}下限`} inputMode="numeric" value={ivMin[index]} onChange={event => updateRange(setIvMin, ivMin, index, event.target.value)} /><input aria-label={`${label}上限`} inputMode="numeric" value={ivMax[index]} onChange={event => updateRange(setIvMax, ivMax, index, event.target.value)} /></div>)}
          </div>
          <div className="static-choice-filters">
              <label>特性<select aria-label="特性筛选" value={ability} onChange={event => setAbility(Number(event.target.value))}><option value={255}>任意</option><option value={0}>0</option><option value={1}>1</option><option value={2}>隐藏</option></select></label>
              <label>性别<select aria-label="性别筛选" value={gender} onChange={event => setGender(Number(event.target.value))}><option value={255}>任意</option><option value={0}>雄性</option><option value={1}>雌性</option><option value={2}>无性别</option></select></label>
              <label>性格<select aria-label="性格筛选" value={nature} onChange={event => setNature(Number(event.target.value))}><option value={-1}>任意</option>{NATURES_ZH.map((item, index) => <option key={item} value={index}>{item}</option>)}</select></label>
              <label>异色<select aria-label="异色筛选" value={shiny} onChange={event => setShiny(Number(event.target.value))}><option value={255}>任意</option><option value={3}>异色</option><option value={1}>Star</option><option value={2}>Square</option><option value={0}>非异色</option></select></label>
          </div>
          <div className="static-size-filters">
            <label>身高<span><input aria-label="身高下限" inputMode="numeric" value={heightMin} onChange={event => setHeightMin(event.target.value.replace(/\D/g, ''))} /><i>–</i><input aria-label="身高上限" inputMode="numeric" value={heightMax} onChange={event => setHeightMax(event.target.value.replace(/\D/g, ''))} /></span></label>
            <label>体重<span><input aria-label="体重下限" inputMode="numeric" value={weightMin} onChange={event => setWeightMin(event.target.value.replace(/\D/g, ''))} /><i>–</i><input aria-label="体重上限" inputMode="numeric" value={weightMax} onChange={event => setWeightMax(event.target.value.replace(/\D/g, ''))} /></span></label>
            <label className="static-check"><input type="checkbox" checked={skipFilter} onChange={event => setSkipFilter(event.target.checked)} />取消筛选</label>
          </div>
        </div>
      </section>
      <section className="static-results-card" aria-label="定点搜索结果">
        <header className="static-results-toolbar"><div className="static-results-actions"><button className="button primary" type="button" onClick={() => void generate()} disabled={generating}><RefreshCw size={13} />{generating ? '生成中' : '生成'}</button>{generating && <button className="button" type="button" onClick={() => void window.desktop?.rng?.cancel().catch(reason => { setError(true); setMessage(String(reason)); })}>取消搜索</button>}<button className="button" type="button" disabled={!results.length} onClick={() => void copy(results)}><Copy size={13} />复制</button><button className="button" type="button" disabled={!results.length} onClick={() => csvDownload(results, resultSpecies, showStats)}><Download size={13} />导出 CSV</button><button className="button" type="button" disabled={!selected} onClick={() => selected && void copy([selected], true)}>复制选中行</button><button className="button" type="button" onClick={() => setTableSettingsOpen(true)}>表格设置</button></div></header>
        <div className="static-results-meta"><span>{results.length} 条结果</span><span className="static-search-status" role={error ? 'alert' : 'status'}>{lookupMessage || message}</span><label className="static-check stats-toggle"><input type="checkbox" checked={showStats} onChange={event => setShowStats(event.target.checked)} />显示能力值</label></div>
        <StaticResultsTable rows={results} columns={visible} showStats={showStats} selectedIndex={selectedIndex} onSelect={setSelectedIndex} onSearchStatus={setLookupMessage}>
          <div className="static-empty-content"><Sparkles size={20} /><strong>{generating ? '搜索中…' : '设置 Seed 和筛选条件后点击生成'}</strong><button className="button" type="button" onClick={() => seedRef.current?.focus()}>设置 Seed 与参数</button></div>
        </StaticResultsTable>
      </section>
    </div>
    {tableSettingsOpen && <StaticTableSettings hidden={hidden} onChange={setHidden} close={() => setTableSettingsOpen(false)} />}
    {calculatorOpen && target && <IvCalculatorDialog initialSpecies={target.speciesId} initialForm={target.form} initialLevel={target.level} close={() => setCalculatorOpen(false)} />}
  </section>;
}
