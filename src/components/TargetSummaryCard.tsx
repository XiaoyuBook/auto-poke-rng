import { useEffect, useState } from 'react';
import { SlidersHorizontal, Sparkles } from 'lucide-react';
import type { TargetFilter } from '../automation';
import { getCategoryLabel, NATURES_ZH, type StaticTarget } from '../staticData';

export type FilterTerm = { text: string; shiny?: boolean };
const stats = ['HP', '攻击', '防御', '特攻', '特防', '速度'];

const range = (min: number, max: number) => min === max ? String(min) : `${min}–${max}`;

export function describeTargetFilter(filter: TargetFilter): FilterTerm[] {
  if (filter.skip) return [{ text: '不限条件' }];
  const terms: FilterTerm[] = [];
  const shiny = ({ 0: '非异色', 1: '星形闪光', 2: '方形闪光', 3: '异色' } as Record<number, string>)[filter.shiny];
  if (shiny) terms.push({ text: shiny, shiny: filter.shiny === 1 || filter.shiny === 2 || filter.shiny === 3 });
  if (filter.ability !== 255) terms.push({ text: `特性 ${filter.ability === 2 ? '隐藏' : filter.ability}` });
  if (filter.gender !== 255) terms.push({ text: `性别 ${['雄性', '雌性', '无性别'][filter.gender] ?? filter.gender}` });
  const selectedNatures = NATURES_ZH.filter((_, index) => filter.natures[index]);
  if (selectedNatures.length !== NATURES_ZH.length) terms.push({ text: `性格 ${selectedNatures.length ? selectedNatures.join('、') : '无可用性格'}` });
  stats.forEach((name, index) => {
    const min = filter.ivMin[index], max = filter.ivMax[index];
    if (min !== 0 || max !== 31) terms.push({ text: `${name} ${range(min, max)}` });
  });
  if (filter.heightMin !== 0 || filter.heightMax !== 255) terms.push({ text: `身高 ${range(filter.heightMin, filter.heightMax)}` });
  if (filter.weightMin !== 0 || filter.weightMax !== 255) terms.push({ text: `体重 ${range(filter.weightMin, filter.weightMax)}` });
  return terms.length ? terms : [{ text: '不限条件' }];
}

function TargetPortrait({ src }: { src?: string }) {
  const [cropped, setCropped] = useState(src);
  useEffect(() => {
    setCropped(src);
    if (!src) return;
    let active = true;
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          if (data[(y * canvas.width + x) * 4 + 3] < 8) continue;
          left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
        if (right < left) return;
        const margin = Math.ceil(Math.max(right - left + 1, bottom - top + 1) * .08);
        left = Math.max(0, left - margin); top = Math.max(0, top - margin);
        right = Math.min(canvas.width - 1, right + margin); bottom = Math.min(canvas.height - 1, bottom + margin);
        const output = document.createElement('canvas');
        output.width = right - left + 1; output.height = bottom - top + 1;
        const outputContext = output.getContext('2d');
        if (!outputContext) return;
        outputContext.drawImage(canvas, left, top, output.width, output.height, 0, 0, output.width, output.height);
        if (active) setCropped(output.toDataURL('image/png'));
      } catch { /* Keep the original sprite if canvas access is unavailable. */ }
    };
    image.src = src;
    return () => { active = false; image.onload = null; };
  }, [src]);
  return <span className="automation-target-portrait">{cropped && <img src={cropped} alt="" />}</span>;
}

export function TargetSummaryCard({ target, sprite, filters, locked, onSettings }: {
  target?: StaticTarget; sprite?: string; filters: TargetFilter[]; locked: boolean; onSettings: () => void;
}) {
  const visible = filters.slice(0, 3);
  return <section className="automation-target-card" aria-label="当前目标与筛选条件">
    <header className="automation-target-heading"><strong>当前目标</strong><button type="button" className="automation-target-settings" disabled={locked} onClick={onSettings}><SlidersHorizontal size={14} aria-hidden="true" />目标设置</button></header>
    <div className="automation-target-main">
      <TargetPortrait src={sprite} />
      <div className="automation-target-identity"><strong>{target?.species || '未选择目标'}</strong>{target && <small>{getCategoryLabel(target.category)} · {target.level} 级{target.roamer ? ' · 游走' : ''}</small>}</div>
    </div>
    <div className="automation-target-conditions">
      <div className="automation-target-conditions-heading"><span>目标条件 <b>{filters.length} 组</b></span><small>满足任意一组即可；同组条件同时满足</small></div>
      <ol className="automation-target-condition-list">{visible.map((filter, index) => <li key={index}>
        {filters.length > 1 && <span className="automation-target-condition-number">{String(index + 1).padStart(2, '0')}</span>}
        <div className="automation-target-condition-terms">{describeTargetFilter(filter).map((term, termIndex) => term.shiny
          ? <span className="automation-target-shiny-term" key={termIndex}><Sparkles size={12} aria-hidden="true" />{term.text}</span>
          : <span className="automation-target-term" key={termIndex}>{term.text}</span>)}</div>
      </li>)}</ol>
      {filters.length > 3 && <button type="button" className="automation-target-more" onClick={onSettings}>查看全部 {filters.length} 组条件</button>}
    </div>
  </section>;
}
