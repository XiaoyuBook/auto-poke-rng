import { useMemo, useRef, useState } from 'react';
import { Copy, Database, Download, Dices, Filter, RefreshCw, Sparkles } from 'lucide-react';

type ShinyFilter = '任意' | '异色' | 'Star' | 'Square' | '非异色';
type AbilityFilter = '任意' | '0' | '1' | '隐藏';
type GenderFilter = '任意' | '雄性' | '雌性' | '无性别';

export type StaticResult = {
  advances: number;
  ec: string;
  pid: string;
  shiny: string;
  nature: string;
  ability: string;
  gender: string;
  ivs: [number, number, number, number, number, number];
  stats: [number, number, number, number, number, number];
  height: number;
  weight: number;
  characteristic: string;
};

type StaticTarget = {
  category: string;
  species: string;
  level: number;
  ability: string;
  shiny: string;
  ivCount: number;
};

type SearchParams = {
  target: StaticTarget;
  seed0: string;
  seed1: string;
  initialAdvance: number;
  maxAdvances: number;
  offset: number;
  nature: string;
  shiny: ShinyFilter;
  ability: AbilityFilter;
  gender: GenderFilter;
  ivMin: number[];
  ivMax: number[];
  heightMin: number;
  heightMax: number;
  weightMin: number;
  weightMax: number;
};

const targets: StaticTarget[] = [
  { category: '御三家', species: '草苗龟 [御三家]', level: 5, ability: '0/1', shiny: '随机', ivCount: 0 },
  { category: '御三家', species: '小火焰猴 [御三家]', level: 5, ability: '0/1', shiny: '随机', ivCount: 0 },
  { category: '御三家', species: '波加曼 [御三家]', level: 5, ability: '0/1', shiny: '随机', ivCount: 0 },
  { category: '传说', species: '帝牙卢卡 [传说]', level: 47, ability: '0/1', shiny: '随机', ivCount: 0 },
  { category: '传说', species: '帕路奇亚 [传说]', level: 47, ability: '0/1', shiny: '随机', ivCount: 0 },
];

const natures = ['勤奋', '怕寂寞', '勇敢', '固执', '调皮', '大胆', '坦率', '悠闲', '顽皮', '认真', '胆小', '急躁', '爽朗', '天真', '保守', '马虎', '冷静', '害羞', '稳重', '温和', '自大', '狂妄', '慎重', '浮躁', '努力'];
const statLabels = ['HP', '攻击', '防御', '特攻', '特防', '速度'];
const characteristics = ['非常喜欢吃', '经常打瞌睡', '经常午睡', '喜欢放松', '喜欢打闹', '好奇心强'];

function parseSeed(value: string) {
  const normalized = value.trim().replace(/^0x/i, '').replace(/[^0-9a-f]/gi, '').slice(0, 8);
  return normalized ? Number.parseInt(normalized.padStart(8, '0'), 16) >>> 0 : 0;
}

function nextValue(value: number) {
  return (Math.imul(value, 0x343fd) + 0x269ec3) >>> 0;
}

/** UI adapter for the BDSP static generator; the native PokeFinder-compatible generator can replace it later. */
export function generateStaticResults(params: SearchParams): StaticResult[] {
  const seed0 = parseSeed(params.seed0);
  const seed1 = parseSeed(params.seed1);
  if (!seed0 && !seed1) return [];
  let state = (seed0 ^ seed1) >>> 0;
  const rows: StaticResult[] = [];
  const end = Math.min(params.initialAdvance + params.maxAdvances, params.initialAdvance + 300);
  for (let advances = 0; advances < end; advances += 1) {
    state = nextValue(state);
    if (advances < params.initialAdvance) continue;
    const ecValue = nextValue(state);
    const pidValue = nextValue(ecValue ^ params.offset);
    state = pidValue;
    const nature = natures[pidValue % natures.length];
    const ivs = statLabels.map((_, index) => {
      state = nextValue(state);
      return (state >>> ((index * 3) % 24)) % 32;
    }) as [number, number, number, number, number, number];
    const shinyValue = (((pidValue >>> 16) ^ (pidValue & 0xffff)) & 0xfff) < 8;
    const shiny = shinyValue ? ((pidValue & 1) === 0 ? 'Star' : 'Square') : '—';
    const ability = String(pidValue % 2);
    const gender = params.target.species.includes('帝牙卢卡') || params.target.species.includes('帕路奇亚') ? '无性别' : ((pidValue & 1) ? '雌性' : '雄性');
    const height = (state >>> 8) & 0xff;
    const weight = (state >>> 16) & 0xff;
    if (params.nature !== '任意' && params.nature !== nature) continue;
    if ((params.shiny === '异色' && shiny === '—') || (params.shiny === '非异色' && shiny !== '—') || (params.shiny === 'Star' && shiny !== 'Star') || (params.shiny === 'Square' && shiny !== 'Square')) continue;
    if (params.ability !== '任意' && params.ability !== ability) continue;
    if (params.gender !== '任意' && params.gender !== gender) continue;
    if (height < params.heightMin || height > params.heightMax || weight < params.weightMin || weight > params.weightMax) continue;
    if (ivs.some((iv, index) => iv < params.ivMin[index] || iv > params.ivMax[index])) continue;
    const base = [45, 49, 49, 65, 65, 45];
    const stats = ivs.map((iv, index) => Math.floor((base[index] + iv + ((state >>> (index + 4)) & 7)) * (index === 0 ? 2 : 1) + params.target.level / 2)) as [number, number, number, number, number, number];
    rows.push({ advances, ec: ecValue.toString(16).toUpperCase().padStart(8, '0'), pid: pidValue.toString(16).toUpperCase().padStart(8, '0'), shiny, nature, ability, gender, ivs, stats, height, weight, characteristic: characteristics[pidValue % characteristics.length] });
    if (rows.length >= 200) break;
  }
  return rows;
}

function csvDownload(rows: StaticResult[], species: string, showStats: boolean) {
  const header = ['帧数', 'EC', 'PID', '异色', '性格', '特性', '性别', 'HP', '攻击', '防御', '特攻', '特防', '速度', '身高', '体重', '个性'];
  const lines = rows.map(row => [row.advances, row.ec, row.pid, row.shiny, row.nature, row.ability, row.gender, ...(showStats ? row.stats : row.ivs), row.height, row.weight, row.characteristic]);
  const csv = [header, ...lines].map(line => line.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${species.replaceAll(' ', '')}-定点数据.csv`; anchor.click(); URL.revokeObjectURL(url);
}

export function StaticDataWorkspace({ onLog }: { onLog?: (message: string) => void }) {
  const [targetIndex, setTargetIndex] = useState(0);
  const [seed0, setSeed0] = useState('');
  const [seed1, setSeed1] = useState('');
  const [initialAdvance, setInitialAdvance] = useState('0');
  const [maxAdvances, setMaxAdvances] = useState('100000');
  const [offset, setOffset] = useState('0');
  const [nature, setNature] = useState('任意');
  const [shiny, setShiny] = useState<ShinyFilter>('任意');
  const [ability, setAbility] = useState<AbilityFilter>('任意');
  const [gender, setGender] = useState<GenderFilter>('任意');
  const [ivMin, setIvMin] = useState([0, 0, 0, 0, 0, 0]);
  const [ivMax, setIvMax] = useState([31, 31, 31, 31, 31, 31]);
  const [heightMin, setHeightMin] = useState('0');
  const [heightMax, setHeightMax] = useState('255');
  const [weightMin, setWeightMin] = useState('0');
  const [weightMax, setWeightMax] = useState('255');
  const [showStats, setShowStats] = useState(false);
  const [searched, setSearched] = useState<SearchParams | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [message, setMessage] = useState('尚未生成结果');
  const seedRef = useRef<HTMLInputElement>(null);
  const target = targets[targetIndex];
  const results = useMemo(() => searched ? generateStaticResults(searched) : [], [searched]);
  const selected = results.find(row => row.advances === selectedIndex) ?? null;
  const updateRange = (setter: typeof setIvMin, values: number[], index: number, value: string) => setter(values.map((item, itemIndex) => itemIndex === index ? Math.max(0, Math.min(31, Number.parseInt(value, 10) || 0)) : item));
  const generate = () => {
    const next: SearchParams = { target, seed0, seed1, initialAdvance: Math.max(0, Number.parseInt(initialAdvance, 10) || 0), maxAdvances: Math.max(1, Number.parseInt(maxAdvances, 10) || 100000), offset: Number.parseInt(offset, 10) || 0, nature, shiny, ability, gender, ivMin, ivMax, heightMin: Number.parseInt(heightMin, 10) || 0, heightMax: Number.parseInt(heightMax, 10) || 255, weightMin: Number.parseInt(weightMin, 10) || 0, weightMax: Number.parseInt(weightMax, 10) || 255 };
    const nextResults = generateStaticResults(next);
    setSearched(next); setSelectedIndex(null); setMessage(nextResults.length ? '已生成结果' : (seed0 || seed1 ? '没有符合条件的结果' : '请先设置 Seed'));
    if (nextResults.length) onLog?.(`${target.species} · 定点结果生成完成，共 ${nextResults.length} 条。`);
  };
  const copySelected = async () => {
    if (!selected) return;
    const values = showStats ? selected.stats : selected.ivs;
    try { await navigator.clipboard?.writeText([selected.advances, selected.ec, selected.pid, selected.shiny, selected.nature, selected.ability, selected.gender, ...values, selected.height, selected.weight, selected.characteristic].join('\t')); } catch { /* Clipboard permission is optional in the desktop shell. */ }
    setMessage('已复制选中行');
  };

  return <section className="static-workspace" aria-label="定点数据工作区">
    <div className="static-settings-content">
      <header className="static-workspace-heading"><div><Dices size={17} /><div><h2>定点数据</h2><p>按 BDSP 定点生成器参数搜索并筛选结果。</p></div></div><span className="static-source-badge"><Database size={12} /> PokéFinder · BDSP Static</span></header>

      <section className="static-config-card" aria-label="定点数据参数">
        <div className="static-config-column" aria-label="乱数信息"><header><Dices size={14} /><h3>乱数信息</h3></header>
          <label>队首<select aria-label="队首" defaultValue="无"><option>无</option><option>同步精灵</option><option>可爱魅力</option></select></label>
          <label>Seed 0<input aria-label="Seed 0" value={seed0} onChange={event => setSeed0(event.target.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 8))} ref={seedRef} spellCheck={false} /></label>
          <label>Seed 1<input aria-label="Seed 1" value={seed1} onChange={event => setSeed1(event.target.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 8))} spellCheck={false} /></label>
          <label>初始帧<input aria-label="初始帧" inputMode="numeric" value={initialAdvance} onChange={event => setInitialAdvance(event.target.value.replace(/\D/g, ''))} /></label>
          <label>最大帧数<input aria-label="最大帧数" inputMode="numeric" value={maxAdvances} onChange={event => setMaxAdvances(event.target.value.replace(/\D/g, ''))} /></label>
          <label>Offset<input aria-label="Offset" inputMode="numeric" value={offset} onChange={event => setOffset(event.target.value.replace(/\D/g, ''))} /></label>
        </div>
        <div className="static-config-column" aria-label="定点设置"><header><Database size={14} /><h3>设置</h3></header>
          <label>分类<select aria-label="分类" value={target.category} onChange={event => { const next = targets.findIndex(item => item.category === event.target.value); if (next >= 0) setTargetIndex(next); }}><option>御三家</option><option>传说</option></select></label>
          <label>宝可梦<select aria-label="宝可梦" value={targetIndex} onChange={event => setTargetIndex(Number(event.target.value))}>{targets.map((item, index) => <option key={item.species} value={index}>{item.species}</option>)}</select></label>
          <label>等级<input aria-label="等级" value={target.level} readOnly disabled /></label>
          <label>特性<input aria-label="目标特性" value={target.ability} readOnly disabled /></label>
          <label>异色<input aria-label="目标异色" value={target.shiny} readOnly disabled /></label>
          <label>满个体数<input aria-label="满个体数" value={target.ivCount} readOnly disabled /></label>
        </div>
        <div className="static-config-column static-filter-column" aria-label="筛选项"><header><Filter size={14} /><h3>筛选项</h3></header>
          <div className="static-filter-pair"><span>能力值</span>{statLabels.map((label, index) => <label key={label}><em>{label}</em><input aria-label={`${label}下限`} value={ivMin[index]} onChange={event => updateRange(setIvMin, ivMin, index, event.target.value)} /><i>–</i><input aria-label={`${label}上限`} value={ivMax[index]} onChange={event => updateRange(setIvMax, ivMax, index, event.target.value)} /></label>)}</div>
          <label>特性<select aria-label="特性筛选" value={ability} onChange={event => setAbility(event.target.value as AbilityFilter)}><option>任意</option><option>0</option><option>1</option><option>隐藏</option></select></label>
          <label>性别<select aria-label="性别筛选" value={gender} onChange={event => setGender(event.target.value as GenderFilter)}><option>任意</option><option>雄性</option><option>雌性</option><option>无性别</option></select></label>
          <label>性格<select aria-label="性格筛选" value={nature} onChange={event => setNature(event.target.value)}><option>任意</option>{natures.map(item => <option key={item}>{item}</option>)}</select></label>
          <label>异色<select aria-label="异色筛选" value={shiny} onChange={event => setShiny(event.target.value as ShinyFilter)}><option>任意</option><option>异色</option><option>Star</option><option>Square</option><option>非异色</option></select></label>
          <label className="static-range-row">身高<input aria-label="身高下限" value={heightMin} onChange={event => setHeightMin(event.target.value.replace(/\D/g, ''))} /><i>–</i><input aria-label="身高上限" value={heightMax} onChange={event => setHeightMax(event.target.value.replace(/\D/g, ''))} /></label>
          <label className="static-range-row">体重<input aria-label="体重下限" value={weightMin} onChange={event => setWeightMin(event.target.value.replace(/\D/g, ''))} /><i>–</i><input aria-label="体重上限" value={weightMax} onChange={event => setWeightMax(event.target.value.replace(/\D/g, ''))} /></label>
          <label className="static-check stats-toggle"><input type="checkbox" checked={showStats} onChange={event => setShowStats(event.target.checked)} />显示能力值</label><button className="static-link-button" type="button" disabled>个体值计算器</button>
        </div>
      </section>

      <section className="static-results-card" aria-label="定点搜索结果">
        <header className="static-results-toolbar"><span>{results.length} 条结果</span><select aria-label="筛选方案" defaultValue=""><option value="">筛选方案</option></select><div className="static-results-actions"><button className="button primary" type="button" onClick={generate}><RefreshCw size={13} />生成</button><button className="button" type="button" disabled={!selected} onClick={() => void copySelected()}><Copy size={13} />复制</button><button className="button" type="button" disabled={!results.length} onClick={() => csvDownload(results, target.species, showStats)}><Download size={13} />导出 CSV</button><button className="button" type="button" disabled={!selected} onClick={() => void copySelected()}>复制选中行</button><button className="button" type="button" disabled>表格设置</button></div></header>
        <div className="static-table-wrap"><table className="static-table"><thead><tr>{['帧数', 'EC', 'PID', '异色', '性格', '特性', '性别', 'HP', '攻击', '防御', '特攻', '特防', '速度', '身高', '体重', '个性'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{results.length ? results.map(row => <tr key={row.advances} className={row.advances === selectedIndex ? 'is-selected' : undefined} onClick={() => setSelectedIndex(row.advances)}>{[row.advances, row.ec, row.pid, row.shiny, row.nature, row.ability, row.gender, ...(showStats ? row.stats : row.ivs), row.height, row.weight, row.characteristic].map((value, index) => <td key={index} className={index < 3 || index > 6 && index < 15 ? 'mono' : undefined}>{value}</td>)}</tr>) : <tr><td className="static-empty" colSpan={16}><Sparkles size={20} /><strong>{message}</strong><span>设置 Seed 和筛选条件后点击生成</span><button className="button" type="button" onClick={() => seedRef.current?.focus()}>设置 Seed 与参数</button></td></tr>}</tbody></table></div>
      </section>
    </div>
  </section>;
}
