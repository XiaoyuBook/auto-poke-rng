import { useState } from 'react';
import type { FrlgBingoState } from '../frlgExecution';

const axis = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
const signed = (value: number) => value > 0 ? `+${value}` : String(value);
const x = (frame: number) => 92 + (frame + 4) * 42;
const y = (seed: number) => 46 + (seed + 4) * 30;

export function FrlgBingoBoard({ state }: { state?: FrlgBingoState | null }) {
  const [selection, setSelection] = useState<{ seed: number; frame: number } | null>(null);
  const observed = !!state && state.observed !== false;
  const cells = state?.grid.flat() || axis.flatMap(seed => axis.map(frame => ({ seed, frame, count: 0, marker: '' })));
  const total = cells.reduce((sum, cell) => sum + cell.count, 0);
  const max = Math.max(1, ...cells.map(cell => cell.count));
  const selected = cells.find(cell => cell.seed === selection?.seed && cell.frame === selection?.frame);
  const prediction = state?.prediction;
  const predictionVisible = prediction && prediction.frame + prediction.frameRadius >= -4 && prediction.frame - prediction.frameRadius <= 4 && prediction.seed + prediction.seedRadius >= -4 && prediction.seed - prediction.seedRadius <= 4;
  const currentVisible = observed && axis.includes(state.current.seed) && axis.includes(state.current.frame);
  const stable = observed && [1, 2].includes(state.stable.type) && state.stable.count >= state.stable.threshold;
  const status = !observed ? '等待校准' : stable ? '检测到稳定簇' : state.current.inRange ? '本轮已计入' : '本轮未计入';
  return <section className="frlg-bingo-state" aria-label="BINGO 状态">
    <header className="frlg-bingo-heading"><div><strong>校准命中分布</strong><span>横轴为帧偏差，纵轴为 Seed 偏差</span></div><span className={`frlg-bingo-badge ${observed && state.current.inRange ? 'is-good' : ''}`}>{status}</span></header>
    <dl className="frlg-bingo-metrics">
      <div><dt>本轮 Seed 偏差</dt><dd>{observed ? signed(state.current.hitSeed) : '—'}<small> 个</small></dd></div>
      <div><dt>本轮帧偏差</dt><dd>{observed ? signed(state.current.hitFrame) : '—'}<small> 帧</small></dd></div>
      <div><dt>图内累计命中</dt><dd>{total}<small> 次</small></dd></div>
    </dl>
    <div className={`frlg-bingo-plot ${observed ? '' : 'is-empty'}`}>
      <svg viewBox="0 0 490 342" role="group" aria-label="Seed 与帧偏差命中分布图">
        <text x="20" y="20" className="bingo-axis-title">Seed 偏差</text>
        {axis.map(value => <g key={value} className="bingo-grid-line">
          <line x1={x(value)} x2={x(value)} y1="31" y2="301" className={value === 0 ? 'is-zero' : ''}/>
          <line x1="71" x2="449" y1={y(value)} y2={y(value)} className={value === 0 ? 'is-zero' : ''}/>
          <text x={x(value)} y="320" textAnchor="middle">{signed(value)}</text><text x="57" y={y(value) + 4} textAnchor="end">{signed(value)}</text>
        </g>)}
        <text x="449" y="339" textAnchor="end" className="bingo-axis-title">帧偏差{state?.context.enterTv ? '（TV 归一化）' : ''}</text>
        {predictionVisible && observed && <rect className="bingo-prediction" x={x(Math.max(-4, prediction.frame - prediction.frameRadius)) - 20} y={y(Math.max(-4, prediction.seed - prediction.seedRadius)) - 14}
          width={(Math.min(4, prediction.frame + prediction.frameRadius) - Math.max(-4, prediction.frame - prediction.frameRadius) + 1) * 42 - 2}
          height={(Math.min(4, prediction.seed + prediction.seedRadius) - Math.max(-4, prediction.seed - prediction.seedRadius) + 1) * 30 - 2} rx="8"/>}
        {stable && <line className="bingo-stable-line" x1={state.stable.type === 1 ? 71 : x(state.stable.frame)} x2={state.stable.type === 1 ? 449 : x(state.stable.frame)} y1={state.stable.type === 1 ? y(state.stable.seed) : 31} y2={state.stable.type === 1 ? y(state.stable.seed) : 301}/>}
        {cells.map(cell => {
          const current = currentVisible && cell.seed === state.current.seed && cell.frame === state.current.frame;
          const label = `Seed 偏差 ${signed(cell.seed)}，帧偏差 ${signed(cell.frame)}，累计命中 ${cell.count} 次${current ? '，本轮落点' : ''}`;
          return <g key={`${cell.seed}:${cell.frame}`} className="bingo-point" role="button" tabIndex={0} aria-label={label} aria-pressed={selected === cell}
            onClick={() => setSelection({ seed: cell.seed, frame: cell.frame })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelection({ seed: cell.seed, frame: cell.frame }); } }}>
            <title>{label}{state?.seedText?.[cell.seed + 4] ? ` · ${state.seedText[cell.seed + 4]}` : ''}</title>
            <rect x={x(cell.frame)-20} y={y(cell.seed)-14} width="40" height="28" rx="5" className="bingo-point-area"/>
            <circle cx={x(cell.frame)} cy={y(cell.seed)} r={cell.count ? 5 + Math.sqrt(cell.count / max) * 6 : 2} className={cell.count ? 'bingo-hit' : 'bingo-dot'}/>
            {cell.count > 0 && <text x={x(cell.frame)} y={y(cell.seed)+3} textAnchor="middle" className="bingo-count">{cell.count}</text>}
            {cell.seed === 0 && cell.frame === 0 && <path d={`M${x(0)-15},${y(0)}h7 M${x(0)+8},${y(0)}h7 M${x(0)},${y(0)-14}v6 M${x(0)},${y(0)+8}v6`} className="bingo-target"/>}
            {current && <circle cx={x(cell.frame)} cy={y(cell.seed)} r="14" className={`bingo-current ${state.current.inRange ? '' : 'is-excluded'}`}/>}
          </g>;
        })}
      </svg>
      {!observed && <div className="frlg-bingo-placeholder"><strong>等待首次命中数据</strong><span>校准后将在这里显示实际落点与预测范围</span></div>}
    </div>
    <div className="frlg-bingo-legend"><span><i className="legend-hit"/>累计命中 · 圆点越大次数越多</span><span><i className="legend-current"/>本轮落点</span><span><i className="legend-prediction"/>预测范围</span><span><i className="legend-excluded"/>未计入</span><span>十字 · 目标中心</span></div>
    {observed && !currentVisible && <p className="frlg-bingo-outside">本轮落点在图外：Seed {signed(state.current.hitSeed)} · 帧 {signed(state.current.hitFrame)}，未计入图内统计。</p>}
    {selected && <p className="frlg-bingo-inspection">选中落点 · Seed {signed(selected.seed)} / 帧 {signed(selected.frame)} · 累计 {selected.count} 次{state?.seedText?.[selected.seed + 4] ? ` · ${state.seedText[selected.seed + 4]}` : ''}</p>}
    {stable && <div className="frlg-bingo-stability"><span>稳定簇 · {state.stable.type === 1 ? `Seed ${signed(state.stable.seed)}` : `帧 ${signed(state.stable.frame)}`}</span><progress max={Math.max(1, state.stable.threshold)} value={state.stable.count}/><strong>{state.stable.count} / {state.stable.threshold}</strong></div>}
    {state?.tv.enabled && <section className="frlg-bingo-tv" aria-label="TV 帧轴"><header><strong>TV 整圈偏差</strong><small>预测 {signed(state.tv.prediction)} ± {state.tv.radius}</small></header><div className="frlg-tv-track">{state.tv.cells.map(cell => <div key={cell.frame} className={`${Math.abs(cell.frame-state.tv.prediction) <= state.tv.radius ? 'is-predicted' : ''} ${observed && cell.frame === state.tv.current ? 'is-current' : ''} ${cell.marker === 'ｘ' ? 'is-excluded' : ''}`} title={`TV 偏差 ${signed(cell.frame)}，累计 ${cell.count} 次`}><strong>{cell.count || '·'}</strong><small>{signed(cell.frame)}</small></div>)}</div></section>}
  </section>;
}
