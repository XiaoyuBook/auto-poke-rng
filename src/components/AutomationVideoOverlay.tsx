import { createPortal } from 'react-dom';
import type { AutomationSnapshot } from '../automation';
import type { VideoState } from '../devices';

type State = AutomationSnapshot['state'];
const capturePhases = new Set(['捕获Seed', '校正位置']);

export function AutomationVideoOverlay({ state, video, target }: { state: State | null | undefined; video: VideoState; target: HTMLElement | null }) {
  if (!target || video.status !== 'connected' || !state?.kind) return null;
  const capture = state.capture;
  const capturing = !!capture && ['start', 'capturing', 'solving'].includes(capture.stage || '');
  const waitingForCapture = capturePhases.has(state.progress?.phase || '') && capture?.stage !== 'complete';
  const seed = !capturing && !waitingForCapture ? state.seed?.seed.pair : null;
  if (!capturing && (!seed || seed.length !== 2)) return null;
  const sizeMatches = capture?.sourceWidth === video.width && capture?.sourceHeight === video.height;

  return createPortal(<div className="automation-video-overlay">
    {capturing && sizeMatches && <svg viewBox={`0 0 ${capture.sourceWidth} ${capture.sourceHeight}`} preserveAspectRatio="xMidYMid meet" aria-label="自动流程眨眼识别区域">
      {capture.roi && <rect className="automation-video-roi" {...capture.roi} />}
      {capture.location && <rect className="automation-video-eye" {...capture.location} />}
    </svg>}
    {capturing && <div className="automation-video-progress" role="status" aria-label="自动流程眨眼捕捉进度"><span>眨眼捕获</span><strong>{capture.captured} / {capture.target}</strong></div>}
    {seed && <div className="automation-video-seed" role="region" aria-label="自动流程 Seed">
      {seed.map((value,index)=><div key={index}><span>Seed {index}</span><code>{value}</code></div>)}
    </div>}
  </div>, target);
}
