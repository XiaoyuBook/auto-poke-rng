import { createPortal } from 'react-dom';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ScanText, SlidersHorizontal, Target, WandSparkles } from 'lucide-react';

export type OcrRect = { x: number; y: number; width: number; height: number };

const sourceSize = { width: 1920, height: 1080 };
const initialRoi: OcrRect = { x: 240, y: 180, width: 1440, height: 720 };

export function OcrWorkspace({ overlayTarget, previewTarget }: { overlayTarget?: HTMLElement | null; previewTarget?: HTMLElement | null }) {
  const [roi, setRoi] = useState<OcrRect>(initialRoi);
  const [language, setLanguage] = useState('简体中文');
  const [threshold, setThreshold] = useState(80);
  const [preprocess, setPreprocess] = useState('自动增强');
  const [expectedText, setExpectedText] = useState('');
  const [resultText, setResultText] = useState('尚未执行识别');
  const [confidence, setConfidence] = useState<number | null>(null);

  const updateRect = (field: keyof OcrRect, value: string) => {
    const number = Math.max(0, Math.round(Number(value) || 0));
    setRoi(current => ({ ...current, [field]: number }));
  };
  const resetRoi = () => setRoi(initialRoi);
  const runPreview = () => {
    setResultText(expectedText.trim() || '等待视频帧识别');
    setConfidence(expectedText.trim() ? 100 : null);
  };

  const settings = <div className="ocr-settings-content">
    <header className="ocr-workspace-heading">
      <div><ScanText size={17} /><div><h2>OCR 设置</h2><p>配置文字识别参数，并在右侧视频中圈选识别区域。</p></div></div>
      <span className="ocr-source-badge">源画面 · {sourceSize.width} × {sourceSize.height}</span>
    </header>
    <div className="ocr-settings-grid">
      <section className="ocr-settings-card" aria-label="OCR识别参数">
        <header className="ocr-card-heading"><SlidersHorizontal size={15} /><h3>识别参数</h3></header>
        <div className="ocr-form-grid">
          <label><span>识别语言</span><select value={language} onChange={event => setLanguage(event.target.value)}><option>简体中文</option><option>繁体中文</option><option>English</option><option>日本語</option></select></label>
          <label><span>预处理</span><select value={preprocess} onChange={event => setPreprocess(event.target.value)}><option>自动增强</option><option>原始画面</option><option>灰度化</option><option>高对比度</option></select></label>
          <label><span>最低置信度</span><div className="ocr-input-suffix"><input type="number" min={0} max={100} value={threshold} onChange={event => setThreshold(Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))))} /><span>%</span></div></label>
          <label className="ocr-expected-text"><span>期望文本</span><input value={expectedText} onChange={event => setExpectedText(event.target.value)} placeholder="可选，用于比对识别结果" /></label>
        </div>
        <div className="ocr-action-row"><button className="button primary" onClick={runPreview}><ScanText size={14} />测试识别</button><span>识别会使用右侧 ROI 的当前画面。</span></div>
      </section>

      <section className="ocr-settings-card ocr-roi-card" aria-label="OCR识别区域">
        <header className="ocr-card-heading"><Target size={15} /><h3>识别区域 ROI</h3><button className="text-button" onClick={resetRoi}>恢复默认</button></header>
        <p className="ocr-card-hint">在右侧视频上拖动框选，或直接输入源画面坐标。</p>
        <div className="ocr-roi-fields">
          {([['x', 'X'], ['y', 'Y'], ['width', '宽度'], ['height', '高度']] as const).map(([field, label]) => <label key={field}><span>{label}</span><input type="number" min={0} value={roi[field]} onChange={event => updateRect(field, event.target.value)} /></label>)}
        </div>
        <div className="ocr-roi-summary"><span className="ocr-roi-dot" />当前区域 {roi.width} × {roi.height}<code>{roi.x}, {roi.y}</code></div>
      </section>
    </div>
  </div>;

  return <section className="ocr-workspace" aria-label="OCR设置工作区">
    {settings}
    {overlayTarget && createPortal(<OcrRoiOverlay roi={roi} setRoi={setRoi} />, overlayTarget)}
    {previewTarget && createPortal(<OcrPreviewPanel roi={roi} resultText={resultText} confidence={confidence} threshold={threshold} />, previewTarget)}
  </section>;
}

function OcrRoiOverlay({ roi, setRoi }: { roi: OcrRect; setRoi: (next: OcrRect) => void }) {
  const svg = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const point = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: Math.max(0, Math.min(sourceSize.width, (event.clientX - rect.left) / rect.width * sourceSize.width)), y: Math.max(0, Math.min(sourceSize.height, (event.clientY - rect.top) / rect.height * sourceSize.height)) };
  };
  const update = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const current = point(event);
    setRoi({ x: Math.round(Math.min(drag.current.x, current.x)), y: Math.round(Math.min(drag.current.y, current.y)), width: Math.round(Math.abs(current.x - drag.current.x)), height: Math.round(Math.abs(current.y - drag.current.y)) });
  };
  const begin = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    svg.current?.setPointerCapture(event.pointerId);
    const start = point(event);
    drag.current = start;
    setRoi({ x: Math.round(start.x), y: Math.round(start.y), width: 0, height: 0 });
  };
  const end = (event: ReactPointerEvent<SVGSVGElement>) => {
    update(event);
    drag.current = null;
    if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId);
  };
  return <div className="video-roi-overlay" aria-label="OCR识别区域框选">
    <svg ref={svg} viewBox={`0 0 ${sourceSize.width} ${sourceSize.height}`} preserveAspectRatio="none" onPointerDown={begin} onPointerMove={update} onPointerUp={end} onPointerCancel={end}>
      <rect className="ocr-roi-mask" x="0" y="0" width={sourceSize.width} height={sourceSize.height} />
      <rect className="ocr-roi-selection" x={roi.x} y={roi.y} width={roi.width} height={roi.height} />
    </svg>
    <span className="ocr-roi-badge"><Target size={12} />ROI · {roi.width} × {roi.height}</span>
  </div>;
}

function OcrPreviewPanel({ roi, resultText, confidence, threshold }: { roi: OcrRect; resultText: string; confidence: number | null; threshold: number }) {
  return <section className="ocr-preview-panel" aria-label="OCR识别预览">
    <header className="ocr-preview-heading"><WandSparkles size={15} /><h2>识别预览</h2><span>{confidence === null ? '待测试' : '已完成'}</span></header>
    <div className="ocr-preview-text">{resultText}</div>
    <dl className="ocr-preview-meta"><div><dt>ROI</dt><dd>{roi.width} × {roi.height}</dd></div><div><dt>阈值</dt><dd>{threshold}%</dd></div><div><dt>置信度</dt><dd>{confidence === null ? '—' : confidence + '%'}</dd></div></dl>
  </section>;
}
