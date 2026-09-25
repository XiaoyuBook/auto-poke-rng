import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { containedPoint, roiFitsEye, type BlinkController, type BlinkRect } from '../blink';
import type { VideoState } from '../devices';

export function BlinkVideoOverlay({ blink, target, video }: { blink: BlinkController; target: HTMLElement | null; video: VideoState }) {
  const { selection } = blink;
  const [draft, setDraft] = useState<BlinkRect | null>(null);
  const [saving, setSaving] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { setDraft(null); start.current = null; setSaving(false); }, [selection]);
  useEffect(() => {
    if (!selection) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); blink.cancelSelection(); } };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [selection, blink.cancelSelection]);
  if (!target) return null;
  const connected = video.status === 'connected';
  const width = selection?.frame.width || video.width || 1920;
  const height = selection?.frame.height || video.height || 1080;
  const configured = blink.config.sourceWidth === width && blink.config.sourceHeight === height;
  const showMatchStatus = connected && configured && Boolean(blink.config.eye && blink.config.roi) && roiFitsEye(blink.config) && !selection;
  const seed = blink.state.result?.pair;
  const currentFrame = blink.state.tracking?.advances ?? blink.state.result?.baselineAdvances;
  const matchingInJob = ['preview', 'capturing'].includes(blink.state.status);
  const location = matchingInJob ? blink.state.location : blink.observation?.location;
  const score = matchingInJob ? blink.state.score : blink.observation?.score;
  const blinking = score != null && score > (blink.config.mode === 'munchlax' ? .4 : .01) && score < blink.config.threshold;
  const advancing = ['tracking', 'countdown', 'timeline'].includes(blink.state.status) || (blink.state.status === 'stopping' && Boolean(blink.state.tracking));
  const capturing = (['starting', 'capturing', 'solving'].includes(blink.state.status) || (blink.state.status === 'stopping' && !advancing)) && blink.state.mode !== 'preview';
  const point = (event: PointerEvent<SVGSVGElement>, clamp = false) => containedPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), width, height, clamp);
  const update = (event: PointerEvent<SVGSVGElement>) => {
    const end = point(event, true);
    if (!start.current || !end) return null;
    const next = { x: Math.min(start.current.x, end.x), y: Math.min(start.current.y, end.y), width: Math.abs(end.x - start.current.x), height: Math.abs(end.y - start.current.y) };
    setDraft(next); return next;
  };
  const complete = async (rect: BlinkRect) => { setSaving(true); try { await blink.finishSelection(rect); } finally { setSaving(false); } };
  return createPortal(<div className={'blink-video-overlay' + (selection ? ' is-selecting' : '')}>
    {connected && selection && <img className="blink-frozen" src={selection.frame.url} alt="眨眼区域框选截图" draggable={false} />}
    {connected && <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-label={selection ? `框选${selection.kind === 'eye' ? '眼睛模板' : '眨眼ROI'}` : '眨眼识别区域'}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
      onPointerDown={event => { if (!selection || saving || event.button !== 2) return; const p = point(event); if (!p) return; event.preventDefault(); start.current = p; setDraft(null); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (start.current) update(event); }} onPointerUp={event => { if (!start.current) return; const rect = update(event); start.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (rect) void complete(rect); }}
      onPointerCancel={() => { start.current = null; setDraft(null); }}>
      {configured && blink.config.roi && <rect className={'blink-roi' + (blinking ? ' is-blinking' : '')} {...blink.config.roi} />}
      {!selection && configured && location && <rect className={'blink-match' + (blinking ? ' is-blinking' : '')} {...location} />}
      {draft && <rect className="blink-draft" {...draft} />}
    </svg>}
    {!selection && <div className="blink-video-seeds" role="region" aria-label="眨眼帧数与 Seed" onContextMenu={event => event.stopPropagation()}>
      <div className="blink-video-seed-row"><span>当前帧数</span><code aria-label="当前帧数">{currentFrame == null ? '—' : currentFrame.toLocaleString()}</code></div>
      {[0, 1].map(index => <div className="blink-video-seed-row" key={index}><span>Seed{index}</span><code aria-label={`捕获 Seed ${index}`}>{seed?.[index] || '—'}</code></div>)}
    </div>}
    {showMatchStatus && <div className={'blink-video-status' + (blinking ? ' is-blinking' : '')} onContextMenu={event => event.stopPropagation()}>
      <div className="blink-video-status-row"><span>匹配 <output aria-label="实时匹配分数" title={blink.observation?.error || '实时模板匹配分数'}>{score == null ? blink.observation?.error ? '异常' : '—' : score.toFixed(4)}</output></span>
        <label>阈值 <input aria-label="眨眼匹配阈值" type="number" min="0.02" max="0.9999" step="0.01" value={blink.config.threshold}
          disabled={blink.busy || blink.selecting} onChange={event => { const threshold = Number(event.target.value); blink.setConfig(current => ({ ...current, threshold })); }} /></label></div>
      {capturing && <div className="blink-video-progress" role="status" aria-label="眨眼捕捉进度"><span>捕捉进度</span><strong>{blink.state.captured} / {blink.state.target}</strong></div>}
      {advancing && <div className="blink-video-progress" role="status" aria-label="眨眼推进状态"><span>{blink.state.status === 'stopping' ? '正在停止推进' : blink.state.status === 'countdown' ? 'Timeline 倒计时' : blink.state.status === 'timeline' ? 'Timeline 推进中' : '持续推进中'}</span><button type="button" disabled={blink.state.status === 'stopping'} onClick={() => void blink.stop()}>停止推进</button></div>}
    </div>}
    {connected && selection && <div className="blink-selection-tools"><span>右键拖动{selection.kind === 'eye' ? '框选睁开的眼睛' : '框选眼睛搜索范围'}{draft ? ` · ${draft.width} × ${draft.height}` : ''}</span><button disabled={saving} onClick={blink.cancelSelection}>取消</button></div>}
  </div>, target);
}
