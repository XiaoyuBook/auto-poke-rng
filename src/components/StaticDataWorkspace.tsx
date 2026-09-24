import { useMemo, useState } from 'react';
import { Check, Copy, Database, Download, Dices, Filter, RefreshCw, Sparkles, Target } from 'lucide-react';

type ShinyFilter = '全部' | '仅闪光' | '排除闪光';

export type StaticResult = {
  advance: number;
  pid: string;
  nature: string;
  shiny: boolean;
  ivs: [number, number, number, number, number, number];
  stats: [number, number, number, number, number, number];
  gender: string;
  ability: string;
};

type StaticTarget = {
  species: string;
  location: string;
  form: string;
  level: number;
};

type SearchParams = {
  target: StaticTarget;
  seed: string;
  start: number;
  count: number;
  nature: string;
  shiny: ShinyFilter;
};

const targets: StaticTarget[] = [
  { species: '帝牙卢卡', location: '枪之柱', form: '通常形态', level: 47 },
  { species: '帕路奇亚', location: '枪之柱', form: '通常形态', level: 47 },
  { species: '克雷色利亚', location: '满月岛', form: '通常形态', level: 50 },
  { species: '由克希', location: '睿智湖', form: '通常形态', level: 50 },
  { species: '艾姆利多', location: '真砂镇', form: '通常形态', level: 50 },
  { species: '亚克诺姆', location: '立志湖', form: '通常形态', level: 50 },
];

const natures = ['任意', '勤奋', '怕寂寞', '勇敢', '固执', '调皮', '大胆', '坦率', '悠闲', '顽皮', '认真', '胆小', '急躁', '爽朗', '天真', '保守', '马虎', '冷静', '害羞', '稳重', '温和', '自大', '狂妄', '慎重', '浮躁', '努力'];
const natureShortNames = ['勤奋', '怕寂寞', '勇敢', '固执', '调皮', '大胆', '坦率', '悠闲', '顽皮', '认真', '胆小', '急躁', '爽朗', '天真', '保守', '马虎', '冷静', '害羞', '稳重', '温和', '自大', '狂妄', '慎重', '浮躁', '努力'];
const statLabels = ['H', 'A', 'B', 'C', 'D', 'S'];

const DEFAULT_SEED = 'A1B2C3D4';

function parseSeed(value: string) {
  const normalized = value.trim().replace(/^0x/i, '').replace(/[^0-9a-f]/gi, '').slice(0, 8);
  if (!normalized) return 0x12345678;
  return Number.parseInt(normalized.padStart(8, '0'), 16) >>> 0;
}

function nextValue(value: number) {
  return (Math.imul(value, 0x343fd) + 0x269ec3) >>> 0;
}

/**
 * UI-facing adapter for the BDSP static generator.
 * The result shape intentionally mirrors the fields used by PokéFinder's
 * static table so the native generator can replace this function later.
 */
export function generateStaticResults(params: SearchParams): StaticResult[] {
  const seed = parseSeed(params.seed);
  const rows: StaticResult[] = [];
  let state = seed;
  const end = Math.min(params.start + params.count, params.start + 240);
  for (let advance = 0; advance < end; advance += 1) {
    state = nextValue(state);
    if (advance < params.start) continue;
    const pidValue = nextValue(state);
    state = pidValue;
    const nature = natureShortNames[pidValue % natureShortNames.length];
    const ivs = statLabels.map((_, index) => {
      state = nextValue(state);
      return (state >>> (index * 3 % 24)) % 32;
    }) as [number, number, number, number, number, number];
    const shiny = (((pidValue >>> 16) ^ (pidValue & 0xffff)) & 0xfff) < 8;
    if ((params.nature !== '任意' && params.nature !== nature) || (params.shiny === '仅闪光' && !shiny) || (params.shiny === '排除闪光' && shiny)) continue;
    const level = params.target.level;
    const base = [150, 115, 100, 120, 100, 90];
    const stats = ivs.map((iv, index) => Math.floor((base[index] + iv + ((state >>> (index + 4)) & 7)) * (index === 0 ? 2 : 1) + level / 2)) as [number, number, number, number, number, number];
    rows.push({ advance, pid: pidValue.toString(16).toUpperCase().padStart(8, '0'), nature, shiny, ivs, stats, gender: '—', ability: (pidValue & 1) ? '特性 1' : '特性 2' });
    if (rows.length >= 200) break;
  }
  return rows;
}

function ivSummary(ivs: StaticResult['ivs']) {
  return ivs.map(value => String(value).padStart(2, '0')).join(' / ');
}

function exportCsv(rows: StaticResult[], target: StaticTarget) {
  const header = ['Advance', 'PID', '性格', '闪光', 'H', 'A', 'B', 'C', 'D', 'S', 'HP', '攻击', '防御', '特攻', '特防', '速度', '性别', '特性'];
  const lines = rows.map(row => [row.advance, row.pid, row.nature, row.shiny ? '是' : '否', ...row.ivs, ...row.stats, row.gender, row.ability]);
  const csv = [header, ...lines].map(line => line.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${target.species}-定点结果.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function StaticDataWorkspace({ onLog }: { onLog?: (message: string) => void }) {
  const [targetIndex, setTargetIndex] = useState(0);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [start, setStart] = useState('0');
  const [count, setCount] = useState('80');
  const [nature, setNature] = useState('任意');
  const [shiny, setShiny] = useState<ShinyFilter>('全部');
  const [searched, setSearched] = useState<SearchParams>(() => ({ target: targets[0], seed: DEFAULT_SEED, start: 0, count: 80, nature: '任意', shiny: '全部' }));
  const [selectedAdvance, setSelectedAdvance] = useState<number | null>(null);
  const [message, setMessage] = useState('等待搜索');
  const target = targets[targetIndex];
  const results = useMemo(() => generateStaticResults(searched), [searched]);
  const selected = results.find(row => row.advance === selectedAdvance) ?? null;
  const runSearch = () => {
    const next = { target, seed, start: Math.max(0, Number.parseInt(start, 10) || 0), count: Math.min(240, Math.max(1, Number.parseInt(count, 10) || 80)), nature, shiny };
    setSearched(next);
    setSelectedAdvance(null);
    setMessage('已完成搜索');
    onLog?.(`${target.species} · 定点搜索完成，找到 ${generateStaticResults(next).length} 条结果。`);
  };
  const applyTarget = () => {
    if (!selected) return;
    setMessage(`已应用 Advance ${selected.advance} 为自动定点目标`);
    onLog?.(`已将 ${target.species} 的 Advance ${selected.advance} 应用为自动定点目标。`);
  };
  const copySelected = async () => {
    if (!selected) return;
    const text = `${target.species} · Advance ${selected.advance} · PID ${selected.pid} · ${selected.nature} · IV ${ivSummary(selected.ivs)}`;
    try { await navigator.clipboard?.writeText(text); } catch { /* Clipboard permission is optional in the desktop shell. */ }
    setMessage('已复制当前结果');
  };

  return <section className="static-workspace" aria-label="定点数据工作区">
    <div className="static-settings-content">
      <header className="static-workspace-heading">
        <div><Dices size={17} /><div><h2>定点数据</h2><p>使用 PokéFinder 定点生成器的字段组织方式，搜索并筛选 BDSP 定点结果。</p></div></div>
        <span className="static-source-badge"><Database size={12} /> PokéFinder · BDSP Static</span>
      </header>

      <section className="static-target-strip" aria-label="当前定点目标">
        <div className="static-target-icon"><Target size={16} /></div>
        <div><span>当前目标</span><strong>{target.species} · {target.location}</strong></div>
        <dl><div><dt>形态</dt><dd>{target.form}</dd></div><div><dt>等级</dt><dd>{target.level}</dd></div><div><dt>结果</dt><dd>{results.length} 条</dd></div></dl>
      </section>

      <section className="static-settings-card" aria-label="定点搜索条件">
        <header className="static-card-heading"><div><Filter size={15} /><h3>搜索条件</h3><span>先设定目标，再搜索 Advance 区间</span></div><span className="static-engine-state"><span className="status-dot success" />适配器已就绪</span></header>
        <div className="static-form-grid">
          <label><span>目标精灵</span><select aria-label="目标精灵" value={targetIndex} onChange={event => setTargetIndex(Number(event.target.value))}>{targets.map((item, index) => <option key={item.species} value={index}>{item.species}</option>)}</select></label>
          <label><span>遭遇类型</span><select aria-label="遭遇类型" defaultValue="定点"><option>定点</option><option>礼物</option><option>传说</option></select></label>
          <label><span>形态</span><select aria-label="目标形态" value={target.form} disabled><option>{target.form}</option></select></label>
          <label><span>等级</span><div className="static-readonly-value">Lv. {target.level}</div></label>
          <label className="static-seed-field"><span>初始 Seed</span><div className="static-input-prefix"><span>0x</span><input aria-label="初始 Seed" value={seed} onChange={event => setSeed(event.target.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 8))} spellCheck={false} /></div></label>
          <label><span>起始 Advance</span><input aria-label="起始 Advance" inputMode="numeric" value={start} onChange={event => setStart(event.target.value.replace(/[^0-9]/g, ''))} /></label>
          <label><span>搜索数量</span><div className="static-input-suffix"><input aria-label="搜索数量" inputMode="numeric" value={count} onChange={event => setCount(event.target.value.replace(/[^0-9]/g, ''))} /><span>条</span></div></label>
          <label><span>性格</span><select aria-label="性格筛选" value={nature} onChange={event => setNature(event.target.value)}>{natures.map(item => <option key={item}>{item}</option>)}</select></label>
          <label><span>闪光</span><select aria-label="闪光筛选" value={shiny} onChange={event => setShiny(event.target.value as ShinyFilter)}><option>全部</option><option>仅闪光</option><option>排除闪光</option></select></label>
        </div>
        <footer className="static-settings-footer"><span className="static-form-hint">搜索范围最多 240 条 · Seed 以十六进制输入</span><button className="button primary" type="button" onClick={runSearch}><RefreshCw size={13} />搜索定点结果</button></footer>
      </section>

      <section className="static-results-card" aria-label="定点搜索结果">
        <header className="static-results-heading"><div><Sparkles size={15} /><h3>搜索结果</h3><span>{message} · {results.length} 条</span></div><div className="static-results-actions"><button className="icon-button" type="button" aria-label="导出定点结果" title="导出 CSV" disabled={!results.length} onClick={() => exportCsv(results, target)}><Download size={14} /></button><button className="icon-button" type="button" aria-label="复制当前定点结果" title="复制当前结果" disabled={!selected} onClick={() => void copySelected()}><Copy size={14} /></button></div></header>
        <div className="static-table-wrap"><table className="static-table"><thead><tr><th>Advance</th><th>PID</th><th>性格</th><th>闪光</th><th>IV（H / A / B / C / D / S）</th><th>能力值</th><th>性别</th><th>特性</th></tr></thead><tbody>{results.length ? results.map(row => <tr key={row.advance} className={row.advance === selectedAdvance ? 'is-selected' : undefined} onClick={() => setSelectedAdvance(row.advance)}><td className="mono">{row.advance}</td><td className="mono">{row.pid}</td><td>{row.nature}</td><td>{row.shiny ? <span className="static-shiny"><Sparkles size={12} />闪光</span> : <span className="static-muted">—</span>}</td><td className="mono static-ivs">{ivSummary(row.ivs)}</td><td className="mono static-stats">{row.stats.join(' / ')}</td><td>{row.gender}</td><td>{row.ability}</td></tr>) : <tr><td className="static-empty" colSpan={8}>没有符合条件的结果，请调整性格或闪光筛选。</td></tr>}</tbody></table></div>
        <footer className="static-results-footer"><span>{selected ? `已选中 Advance ${selected.advance} · PID ${selected.pid}` : '点击结果行查看并应用目标'}</span><div><button className="button" type="button" disabled={!selected} onClick={() => void copySelected()}><Copy size={13} />复制</button><button className="button primary" type="button" disabled={!selected} onClick={applyTarget}><Check size={13} />应用为自动定点目标</button></div></footer>
      </section>
    </div>
  </section>;
}
