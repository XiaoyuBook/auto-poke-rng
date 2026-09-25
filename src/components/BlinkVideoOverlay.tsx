import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { containedPoint, type BlinkController, type BlinkRect } from '../blink';
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
  if (!target || video.status !== 'connected') return null;
  const width = selection?.frame.width || video.width || 1920;
  const height = selection?.frame.height || video.height || 1080;
  const configured = blink.config.sourceWidth === width && blink.config.sourceHeight === height;
  const point = (event: PointerEvent<SVGSVGElement>, clamp = false) => containedPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), width, height, clamp);
  const update = (event: PointerEvent<SVGSVGElement>) => {
    const end = point(event, true);
    if (!start.current || !end) return null;
    const next = { x: Math.min(start.current.x, end.x), y: Math.min(start.current.y, end.y), width: Math.abs(end.x - start.current.x), height: Math.abs(end.y - start.current.y) };
    setDraft(next); return next;
  };
  const complete = async () => { if (draft) { setSaving(true); await blink.finishSelection(draft); setSaving(false); } };
  return createPortal(<div className={'blink-video-overlay' + (selection ? ' is-selecting' : '')}>
    {selection && <img className="blink-frozen" src={selection.frame.url} alt="眨眼区域框选截图" draggable={false} />}
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-label={selection ? `框选${selection.kind === 'eye' ? '眼睛模板' : '眨眼ROI'}` : '眨眼识别区域'}
      onPointerDown={event => { if (!selection || saving || event.button !== 0) return; const p = point(event); if (!p) return; event.preventDefault(); start.current = p; setDraft(null); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (start.current) update(event); }} onPointerUp={event => { if (start.current) update(event); start.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { start.current = null; setDraft(null); }}>
      {configured && blink.config.roi && <rect className="blink-roi" {...blink.config.roi} />}
      {!selection && blink.busy && blink.state.location && <rect className={'blink-match' + ((blink.state.score ?? 0) < blink.config.threshold ? ' is-low' : '')} {...blink.state.location} />}
      {draft && <rect className="blink-draft" {...draft} />}
    </svg>
    {selection && <div className="blink-selection-tools"><span>{selection.kind === 'eye' ? '框选睁开的眼睛' : '框选眼睛搜索范围'}{draft ? ` · ${draft.width} × ${draft.height}` : ''}</span><button disabled={!draft || saving} onClick={() => void complete()}>确认</button><button disabled={saving} onClick={blink.cancelSelection}>取消</button></div>}
  </div>, target);
}
