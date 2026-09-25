import { useEffect, useRef, useState } from 'react';
import { CALCULATOR_SPECIES, CHARACTERISTICS_ZH, HIDDEN_POWERS_ZH, NATURES_ZH } from '../staticData';
import type { IvCalculationRequest, IvCalculationResult } from '../desktop';
import { Dialog } from './Dialog';

const labels = ['HP', '攻击', '防御', '特攻', '特防', '速度'];
type Entry = { level: string; stats: string[] };
const emptyEntry = (level = 1): Entry => ({ level: String(level), stats: ['', '', '', '', '', ''] });
export function formatIvRange(values: number[]) {
  const parts: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = values[i];
    while (i + 1 < values.length && values[i + 1] === values[i] + 1) i++;
    parts.push(start === values[i] ? String(start) : `${start}–${values[i]}`);
  }
  return parts.join('、') || '—';
}
export function IvCalculatorDialog({ initialSpecies, initialForm = 0, initialLevel = 1, close }: {
  initialSpecies: number; initialForm?: number; initialLevel?: number; close: () => void;
}) {
  const [species, setSpecies] = useState(initialSpecies);
  const [form, setForm] = useState(initialForm);
  const [query, setQuery] = useState('');
  const [nature, setNature] = useState(255);
  const [characteristic, setCharacteristic] = useState(255);
  const [hiddenPower, setHiddenPower] = useState(255);
  const [entries, setEntries] = useState<Entry[]>([emptyEntry(initialLevel)]);
  const [result, setResult] = useState<IvCalculationResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  useEffect(() => () => { requestId.current++; }, []);
  const pokemon = CALCULATOR_SPECIES.find(item => item.id === species) ?? CALCULATOR_SPECIES[0];
  const selectedForm = pokemon.forms.find(item => item.id === form) ?? pokemon.forms[0];
  const options = CALCULATOR_SPECIES.filter(item => !query.trim() || item.name.includes(query.trim()) || String(item.id).includes(query.trim()));
  const invalidate = () => { requestId.current++; setResult(null); setError(''); setBusy(false); };
  const changeEntry = (row: number, stat: number, value: string) => {
    invalidate();
    setEntries(current => current.map((entry, index) => index !== row ? entry : stat < 0 ? { ...entry, level: value } : { ...entry, stats: entry.stats.map((old, index) => index === stat ? value : old) }));
  };
  const calculate = async () => {
    const id = ++requestId.current;
    setResult(null); setError('');
    try {
      const api = window.desktop?.rng?.calculateIvs;
      if (!api) throw new Error('请在桌面应用中使用原生个体值计算器。');
      const integer = (text: string, max: number, label: string) => {
        if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > max) throw new Error(`${label}须为 1–${max} 的整数。`);
        return Number(text);
      };
      const request: IvCalculationRequest = { species: pokemon.id, form: selectedForm.id, nature, characteristic, hiddenPower, entries: entries.map((entry, row) => ({
        level: integer(entry.level, 100, `第 ${row + 1} 行等级`), stats: entry.stats.map((value, index) => integer(value, 9999, `第 ${row + 1} 行${labels[index]}`)),
      })) };
      setBusy(true);
      const next = await api(request);
      if (id === requestId.current) setResult(next);
    } catch (reason) {
      if (id === requestId.current) setError(reason instanceof Error ? reason.message : '个体值计算失败。');
    } finally { if (id === requestId.current) setBusy(false); }
  };
  return <Dialog title="个体值计算器" close={close} className="iv-calculator-dialog">
    <div className="bdsp-tool-body">
      <p className="bdsp-tool-hint">珍钻复刻 · 按努力值为 0 计算。输入实际能力值；同一只宝可梦可录入多个等级来缩小范围。</p>
      <div className="iv-calculator-settings">
        <label>查找宝可梦<input type="search" aria-label="查找宝可梦" placeholder="名称或全国图鉴编号" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <label>宝可梦<select aria-label="计算器宝可梦" value={pokemon.id} onChange={event => { invalidate(); setSpecies(Number(event.target.value)); setForm(0); }}>
          {!options.some(item => item.id === pokemon.id) && <option value={pokemon.id}>{pokemon.name} · #{pokemon.id}</option>}
          {options.map(item => <option key={item.id} value={item.id}>{item.name} · #{item.id}</option>)}
        </select></label>
        {pokemon.forms.length > 1 && <label>形态<select aria-label="计算器形态" value={selectedForm.id} onChange={event => { invalidate(); setForm(Number(event.target.value)); }}>{pokemon.forms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <label>性格<select aria-label="计算器性格" value={nature} onChange={event => { invalidate(); setNature(Number(event.target.value)); }}><option value={255}>未知</option>{NATURES_ZH.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>
        <label>个性<select aria-label="计算器个性" value={characteristic} onChange={event => { invalidate(); setCharacteristic(Number(event.target.value)); }}><option value={255}>未知</option>{CHARACTERISTICS_ZH.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>
        <label>觉醒力量<select aria-label="计算器觉醒力量" value={hiddenPower} onChange={event => { invalidate(); setHiddenPower(Number(event.target.value)); }}><option value={255}>未知</option>{HIDDEN_POWERS_ZH.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>
      </div>
      {query.trim() && !options.length && <p className="bdsp-tool-hint">没有匹配的宝可梦，当前选择保持为{pokemon.name}。</p>}
      <section className="iv-calculator-entries" aria-label="能力值输入">
        <header><h3>能力值输入</h3><div><button className="button" type="button" disabled={entries.length >= 100} onClick={() => { invalidate(); setEntries(current => [...current, emptyEntry()]); }}>新增行</button><button className="button" type="button" disabled={entries.length === 1} onClick={() => { invalidate(); setEntries(current => current.slice(0, -1)); }}>删除行</button></div></header>
        <div className="iv-entry-scroll"><table><thead><tr>{['等级', ...labels].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{entries.map((entry, row) => <tr key={row}>
          <td><input aria-label={`第 ${row + 1} 行等级`} inputMode="numeric" value={entry.level} onChange={event => changeEntry(row, -1, event.target.value)} /></td>
          {entry.stats.map((value, index) => <td key={index}><input aria-label={`第 ${row + 1} 行${labels[index]}`} inputMode="numeric" value={value} onChange={event => changeEntry(row, index, event.target.value)} /></td>)}
        </tr>)}</tbody></table></div>
      </section>
      <section className="iv-calculator-results" aria-label="个体值计算结果">
        <table><thead><tr><th>属性</th><th>种族值</th><th>可能的个体值</th><th>建议复测等级</th></tr></thead><tbody>{labels.map((label, index) => <tr key={label}><th>{label}</th><td>{selectedForm.stats[index]}</td><td>{result?.possible ? formatIvRange(result.ivs[index]) : '—'}</td><td>{result?.possible ? result.nextLevels[index] ?? '—' : '—'}</td></tr>)}</tbody></table>
      </section>
      <p className="bdsp-tool-hint">建议复测等级用于进一步区分候选个体值；“—”表示已确定或没有更高等级可缩小范围。</p>
      {error && <p role="alert" className="bdsp-tool-error">{error}</p>}
      <p role="status" className="bdsp-tool-hint">{busy ? '正在计算…' : result ? result.possible ? '计算完成' : '没有符合全部输入条件的个体值，请检查等级、能力值、性格和努力值。' : '填写能力值后点击计算'}</p>
    </div>
    <footer className="bdsp-tool-actions"><button className="button" type="button" onClick={close}>关闭</button><button className="button primary" type="button" disabled={busy} onClick={() => void calculate()}>{busy ? '计算中…' : '计算'}</button></footer>
  </Dialog>;
}
