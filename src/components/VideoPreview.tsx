import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Camera, CircleHelp, Focus, Image, ImagePlus, MonitorPlay, Play, Save, ScanSearch, Search, Tag, Tags, X } from 'lucide-react';
import { useDevices } from '../useDevices';
import type { Snapshot } from '../devices';
import type { LabelRecord, LabelRect } from '../scriptLibrary';

function LiveVideo() {
  const { video } = useDevices();
  return video.status === 'connected' && video.previewUrl
    ? <img className="live-video" src={video.previewUrl} alt="实时视频画面" draggable={false} />
    : <><MonitorPlay size={28} /><strong>{video.status === 'connecting' ? '正在连接视频源…' : video.status === 'failed' ? '视频源已中断' : '等待视频源连接'}</strong></>;
}

export function VideoLabelsButton({ expanded, toggle, variant = 'icon' }: { expanded: boolean; toggle: () => void; variant?: 'icon' | 'tool' }) {
  if (variant === 'tool') return <button className={'editor-tool-button label-tool ' + (expanded ? 'active' : '')} title="图像标签" aria-label="标签"
    aria-expanded={expanded} onClick={toggle}><Tags size={14} /><span>图像标签</span></button>;
  return <button className={'icon-button ' + (expanded ? 'active' : '')} title="标签" aria-label="标签"
    aria-expanded={expanded} onClick={toggle}><Tags size={15} /></button>;
}

export function VideoPreview({ labelsOpen = false, labelFolder = '', previewOnly = false, labelsOnly = false, referenceTarget = null, onCloseLabels }: { labelsOpen?: boolean; labelFolder?: string; previewOnly?: boolean; labelsOnly?: boolean; referenceTarget?: HTMLElement | null; onCloseLabels?: () => void }) {
  return <section className="video-preview-content" aria-label="视频画面" data-labels-open={labelsOpen}>
    {!labelsOnly && !labelsOpen && <div className="preview-stage">
      <div className="preview-frame"><LiveVideo /></div>
    </div>}
    {!previewOnly && <div className="image-label-content" hidden={!labelsOpen}><ImageLabelWorkspace active={labelsOpen} labelFolder={labelFolder} cornerLayout={labelsOnly} referenceTarget={referenceTarget} onCloseLabels={onCloseLabels} /></div>}
  </section>;
}

type SelectionKind = 'range' | 'target';
type MatchResult = { score: number; maxScore: number; elapsedMs: number; liveUrl: string; targetUrl: string; x: number; y: number; recognizedText?: string };
const blankRect = (): LabelRect => ({ x: 0, y: 0, width: 0, height: 0 });
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const rectFromPoints = (start: { x: number; y: number }, end: { x: number; y: number }): LabelRect => ({
  x: Math.round(Math.min(start.x, end.x)), y: Math.round(Math.min(start.y, end.y)),
  width: Math.round(Math.abs(start.x - end.x)), height: Math.round(Math.abs(start.y - end.y)),
});
const rectInside = (rect: LabelRect, width: number, height: number) => rect.x >= 0 && rect.y >= 0
  && rect.width > 0 && rect.height > 0 && rect.x + rect.width <= width && rect.y + rect.height <= height;
function stringSimilarity(left: string, right: string): number {
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  if (left === right) return 1;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) {
      current.push(Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)));
    }
    for (let index = 0; index < current.length; index++) previous[index] = current[index];
  }
  return Math.max(0, 1 - previous[right.length] / Math.max(left.length, right.length));
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('无法读取图像。')); image.src = url;
  });
}

async function cropImage(url: string, rect: LabelRect): Promise<string> {
  const image = await loadImage(url);
  const canvas = document.createElement('canvas'); canvas.width = rect.width; canvas.height = rect.height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('当前环境不支持图像处理。');
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return canvas.toDataURL('image/png');
}

async function matchImage(liveUrl: string, templateUrl: string, range: LabelRect, target: LabelRect): Promise<{ score: number; x: number; y: number }> {
  const [live, template] = await Promise.all([loadImage(liveUrl), loadImage(templateUrl)]);
  const liveCanvas = document.createElement('canvas'); liveCanvas.width = live.naturalWidth; liveCanvas.height = live.naturalHeight;
  const templateCanvas = document.createElement('canvas'); templateCanvas.width = target.width; templateCanvas.height = target.height;
  const liveContext = liveCanvas.getContext('2d'); const templateContext = templateCanvas.getContext('2d');
  if (!liveContext || !templateContext) throw new Error('当前环境不支持图像处理。');
  liveContext.drawImage(live, 0, 0); templateContext.drawImage(template, 0, 0);
  const source = liveContext.getImageData(0, 0, liveCanvas.width, liveCanvas.height).data;
  const wanted = templateContext.getImageData(0, 0, target.width, target.height).data;
  const right = Math.min(range.x + range.width - target.width, live.naturalWidth - target.width);
  const bottom = Math.min(range.y + range.height - target.height, live.naturalHeight - target.height);
  if (right < range.x || bottom < range.y) throw new Error('搜索目标必须位于搜索范围内。');
  const area = (right - range.x + 1) * (bottom - range.y + 1);
  const positionStep = Math.max(1, Math.ceil(Math.sqrt(area / 120000)));
  const pixelStep = Math.max(1, Math.ceil(Math.sqrt((target.width * target.height) / 12000)));
  let best = { score: -1, x: range.x, y: range.y };
  for (let y = range.y; y <= bottom; y += positionStep) for (let x = range.x; x <= right; x += positionStep) {
    let error = 0; let count = 0;
    for (let ty = 0; ty < target.height; ty += pixelStep) for (let tx = 0; tx < target.width; tx += pixelStep) {
      const sourceIndex = ((y + ty) * live.naturalWidth + x + tx) * 4;
      const wantedIndex = (ty * target.width + tx) * 4;
      error += Math.abs(source[sourceIndex] - wanted[wantedIndex]);
      error += Math.abs(source[sourceIndex + 1] - wanted[wantedIndex + 1]);
      error += Math.abs(source[sourceIndex + 2] - wanted[wantedIndex + 2]);
      count += 3;
    }
    const score = Math.max(0, 100 * (1 - error / (count * 255)));
    if (score > best.score) best = { score, x, y };
  }
  return best;
}

function ImageLabelWorkspace({ active, labelFolder, cornerLayout, referenceTarget, onCloseLabels }: { active: boolean; labelFolder: string; cornerLayout: boolean; referenceTarget?: HTMLElement | null; onCloseLabels?: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    const api = window.desktop?.devices?.video;
    if (!api) return;
    let active = true, changed = false;
    const unsubscribe = api.onSnapshot(frame => { changed = true; if (active) setSnapshot(frame); });
    void api.getSnapshot().then(frame => { if (active && !changed) setSnapshot(frame); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, []);
  const captureSnapshot = async () => {
    try {
      const api = window.desktop?.devices?.video;
      if (!api) throw new Error('请使用桌面应用连接视频源。');
      const frame = await api.snapshot(); setSnapshot(frame); setNotice(`已截取第 ${frame.sequence} 帧 · ${frame.width} × ${frame.height}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  const [mode, setMode] = useState<'range' | 'target' | null>(null);
  const [notice, setNotice] = useState('');
  const [range, setRange] = useState<LabelRect>(blankRect);
  const [target, setTarget] = useState<LabelRect>(blankRect);
  const [name, setName] = useState('');
  const [expectedText, setExpectedText] = useState('');
  const [searchMethod, setSearchMethod] = useState('template');
  const [threshold, setThreshold] = useState(95);
  const [labels, setLabels] = useState<LabelRecord[]>([]);
  const [filter, setFilter] = useState('');
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [dynamicTesting, setDynamicTesting] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ kind: SelectionKind; start: { x: number; y: number } } | null>(null);
  const dynamicTimer = useRef<number | null>(null);

  const reloadLabels = useCallback(async () => {
    const list = window.desktop?.scripts?.labelsList;
    if (!list) return;
    try { setLabels((await list(labelFolder)).labels); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }, [labelFolder]);
  useEffect(() => { void reloadLabels(); }, [reloadLabels]);
  useEffect(() => {
    if (active) return;
    if (dynamicTimer.current !== null) window.clearInterval(dynamicTimer.current);
    dynamicTimer.current = null;
    setDynamicTesting(false);
    return undefined;
  }, [active]);
  useEffect(() => () => { if (dynamicTimer.current !== null) window.clearInterval(dynamicTimer.current); }, []);

  const sourcePoint = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!snapshot || !svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const scale = Math.min(rect.width / snapshot.width, rect.height / snapshot.height);
    const offsetX = (rect.width - snapshot.width * scale) / 2;
    const offsetY = (rect.height - snapshot.height * scale) / 2;
    return { x: clamp((event.clientX - rect.left - offsetX) / scale, 0, snapshot.width), y: clamp((event.clientY - rect.top - offsetY) / scale, 0, snapshot.height) };
  };
  const updateSelection = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const next = rectFromPoints(drag.current.start, sourcePoint(event));
    if (drag.current.kind === 'range') setRange(next); else setTarget(next);
  };
  const beginSelection = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!mode || !snapshot) return;
    event.preventDefault(); svgRef.current?.setPointerCapture(event.pointerId);
    drag.current = { kind: mode, start: sourcePoint(event) }; updateSelection(event);
  };
  const endSelection = (event: ReactPointerEvent<SVGSVGElement>) => {
    updateSelection(event); drag.current = null;
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
  };
  const changeRect = (kind: SelectionKind, field: keyof LabelRect, value: string) => {
    const number = Math.max(0, Number(value) || 0);
    (kind === 'range' ? setRange : setTarget)(current => ({ ...current, [field]: Math.round(number) }));
  };
  const loadLabel = async (item: LabelRecord) => {
    const read = window.desktop?.scripts?.labelRead;
    if (!read) return;
    try {
      const full = await read(labelFolder, item.name);
      setName(full.name); setRange(full.range); setTarget(full.target); setThreshold(full.threshold || 95);
      setSearchMethod(full.searchMethod === 107 ? 'ocr' : full.searchMethod === 2 ? 'color' : 'template');
      setExpectedText(full.searchMethod === 107 ? full.imageBase64 || '' : ''); setNotice(`已加载标签“${full.name}”。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  const performSearch = useCallback(async () => {
    if (!snapshot) throw new Error('请先截图。');
    if (range.width <= 0 || range.height <= 0 || target.width <= 0 || target.height <= 0) throw new Error('请先圈选搜索范围和搜索目标。');
    if (!rectInside(range, snapshot.width, snapshot.height) || !rectInside(target, snapshot.width, snapshot.height)) throw new Error('圈选区域必须位于截图范围内。');
    if (target.x < range.x || target.y < range.y || target.x + target.width > range.x + range.width || target.y + target.height > range.y + range.height) throw new Error('搜索目标必须位于搜索范围内。');
    if (searchMethod === 'ocr' && !expectedText.trim()) throw new Error('请填写 OCR 期望文本。');
    const targetUrl = await cropImage(snapshot.url, target);
    const videoApi = window.desktop?.devices?.video;
    if (!videoApi) throw new Error('请使用桌面应用连接视频源。');
    const started = performance.now(); const live = await videoApi.snapshot();
    let result: { score: number; x: number; y: number; recognizedText?: string };
    if (searchMethod === 'ocr') {
      const liveTargetUrl = await cropImage(live.url, target);
      const encoded = liveTargetUrl.split(',')[1] || '';
      const recognized = await videoApi.ocr(encoded);
      const text = recognized.text.trim();
      result = { score: stringSimilarity(text, expectedText.trim()) * recognized.confidence * 100, x: target.x, y: target.y, recognizedText: text };
    } else {
      result = await matchImage(live.url, targetUrl, range, target);
    }
    const liveTargetUrl = await cropImage(live.url, { x: result.x, y: result.y, width: target.width, height: target.height });
    setMatch(current => ({ ...result, maxScore: Math.max(current?.maxScore || 0, result.score), elapsedMs: Math.round(performance.now() - started), liveUrl: liveTargetUrl, targetUrl }));
    setNotice(`识别完成：${result.score.toFixed(1)}%${result.recognizedText === undefined ? '' : ` · “${result.recognizedText}”`} · ${Math.round(performance.now() - started)} ms`);
  }, [expectedText, range, searchMethod, snapshot, target]);
  const startDynamic = () => {
    if (dynamicTesting) { if (dynamicTimer.current !== null) window.clearInterval(dynamicTimer.current); dynamicTimer.current = null; setDynamicTesting(false); setNotice('动态测试已停止。'); return; }
    void performSearch().then(() => {
      if (!active) return;
      setDynamicTesting(true); setNotice('动态测试运行中…');
      dynamicTimer.current = window.setInterval(() => { void performSearch().catch(error => setNotice(error instanceof Error ? error.message : String(error))); }, 1000);
    }).catch(error => setNotice(error instanceof Error ? error.message : String(error)));
  };
  const saveLabel = async () => {
    const save = window.desktop?.scripts?.labelSave;
    if (!save) throw new Error('当前环境不支持保存标签。');
    if (!snapshot || !name.trim()) throw new Error('请先截图并填写标签名称。');
    if (range.width <= 0 || range.height <= 0 || target.width <= 0 || target.height <= 0) throw new Error('请先圈选搜索范围和搜索目标。');
    if (!rectInside(range, snapshot.width, snapshot.height) || !rectInside(target, snapshot.width, snapshot.height)) throw new Error('圈选区域必须位于截图范围内。');
    if (target.x < range.x || target.y < range.y || target.x + target.width > range.x + range.width || target.y + target.height > range.y + range.height) throw new Error('搜索目标必须位于搜索范围内。');
    if (searchMethod === 'ocr' && !expectedText.trim()) throw new Error('请填写 OCR 期望文本。');
    const imageBase64 = searchMethod === 'ocr' ? expectedText.trim() : (await cropImage(snapshot.url, target)).split(',')[1];
    const item = await save({ folder: labelFolder, name: name.trim(), searchMethod: searchMethod === 'ocr' ? 107 : searchMethod === 'color' ? 2 : 5, threshold, range, target, imageBase64 });
    setLabels(current => [...current.filter(label => label.name !== item.name), { ...item, imageBase64: undefined }].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')));
    setNotice(`已保存标签“${item.name}”。`);
  };
  const referencePanel = <LabelReference labels={labels} filter={filter} onFilterChange={setFilter} loadLabel={loadLabel} />;
  const renderedReferencePanel = referenceTarget ? createPortal(referencePanel, referenceTarget) : referencePanel;

  return <div className="image-label-workspace" aria-label="图像标签工作区">
    <div className="image-label-grid">
      <section className="label-snapshot-section" aria-label="截图静态帧">
        <header className="label-section-heading"><h4><Image size={14} />截图画布</h4><div className="label-section-heading-actions"><span>静态帧</span>{onCloseLabels && <button className="icon-button label-close-button" type="button" title="关闭图像标签" aria-label="关闭图像标签" onClick={onCloseLabels}><X size={15} /></button>}</div></header>
        <div className="label-snapshot-stage">
          <div className="label-snapshot-frame">
            {snapshot ? <div className="label-image-overlay-wrap"><img className="snapshot-video" src={snapshot.url} alt="截图静态帧" draggable={false} /><svg ref={svgRef} className="label-selection-overlay" viewBox={`0 0 ${snapshot.width} ${snapshot.height}`} preserveAspectRatio="xMidYMid meet" onPointerDown={beginSelection} onPointerMove={updateSelection} onPointerUp={endSelection} onPointerCancel={endSelection}><rect className="label-selection-range" x={range.x} y={range.y} width={range.width} height={range.height} /><rect className="label-selection-target" x={target.x} y={target.y} width={target.width} height={target.height} /></svg></div> : <><ImagePlus size={30} /><strong>尚未截图</strong><p>从右侧实时画面截取一帧，在这里圈选与标注</p></>}
          </div>
        </div>
        <div className="label-canvas-caption"><span>选择工具后拖动圈选</span><span>100%</span></div>
      </section>

      {!cornerLayout && <section className="label-monitor-section" aria-label="实时视频监视器">
        <header className="label-section-heading"><h4><MonitorPlay size={14} />实时画面</h4></header>
        <div className="label-monitor-stage">
          <div className="label-monitor-frame">{active && <LiveVideo />}</div>
        </div>
      </section>}

      <div className="label-details">
      <section className="label-edit-section" aria-label="图像标签编辑">
        <div className="label-action-bar" role="toolbar" aria-label="截图与圈选工具">
          <button className="button" onClick={() => void captureSnapshot()}><Camera size={14} />截图</button>
          <button className={'button label-selection-button range ' + (mode === 'range' ? 'active' : '')} aria-pressed={mode === 'range'} title="红框：圈选搜索范围" onClick={() => setMode(value => value === 'range' ? null : 'range')}><span className="label-color-dot" />搜索范围</button>
          <button className={'button label-selection-button target ' + (mode === 'target' ? 'active' : '')} aria-pressed={mode === 'target'} title="绿框：圈选搜索目标" onClick={() => setMode(value => value === 'target' ? null : 'target')}><span className="label-color-dot" />搜索目标</button>
          <button className="button" onClick={() => void performSearch().catch(error => setNotice(error instanceof Error ? error.message : String(error)))}><ScanSearch size={14} />搜索测试</button>
          <button className="button" aria-pressed={dynamicTesting} onClick={startDynamic}><Play size={13} />{dynamicTesting ? '停止动态' : '动态测试'}</button>
          <button className="button" onClick={() => void saveLabel().catch(error => setNotice(error instanceof Error ? error.message : String(error)))}><Save size={14} />保存标签</button>
          <button className="button" onClick={() => void captureSnapshot()}><ImagePlus size={14} />打开截图</button>
        </div>
        <div className="label-parameters">
          <header className="label-section-heading"><h4>搜索参数</h4><span>{mode === 'range' ? '搜索范围 · 红框' : mode === 'target' ? '搜索目标 · 绿框' : '选择圈选工具'}</span></header>
          <div className="label-parameter-body">
            <div className="label-form-fields">
              <label><span>标签名称</span><input type="text" placeholder="输入标签名称" aria-label="标签名称" value={name} onChange={event => setName(event.target.value)} /></label>
              <label><span>搜索方法</span><select aria-label="搜索方法" value={searchMethod} onChange={event => setSearchMethod(event.target.value)}><option value="template">模板匹配</option><option value="color">颜色匹配</option><option value="ocr">OCR 文本匹配</option></select></label>
              {searchMethod === 'ocr' && <label><span>期望文本</span><input type="text" placeholder="输入识别文本" aria-label="OCR 期望文本" value={expectedText} onChange={event => setExpectedText(event.target.value)} /></label>}
              <label><span>最低匹配度</span><div className="label-threshold"><input type="number" aria-label="最低匹配度" min={0} max={100} value={threshold} onChange={event => setThreshold(clamp(Math.round(Number(event.target.value) || 0), 0, 100))} /><span>%</span></div></label>
            </div>
            <section className="label-match-preview" aria-label="动态测试对照">
              <div className="label-match-comparison">
                <figure><figcaption>实时区域</figcaption>{match ? <img src={match.liveUrl} alt="实时匹配画面" /> : <div className="label-region-placeholder"><MonitorPlay size={20} /><span>等待实时画面</span></div>}</figure>
                <figure><figcaption>标签截图</figcaption>{match ? <img src={match.targetUrl} alt="标签截图" /> : <div className="label-region-placeholder"><Focus size={20} /><span>等待标签截图</span></div>}</figure>
              </div>
              <dl><div><dt>匹配度</dt><dd>{match ? match.score.toFixed(1) + '%' : '—'}</dd></div><div><dt>耗时</dt><dd>{match ? match.elapsedMs : '—'} <small>ms</small></dd></div><div><dt>最大匹配度</dt><dd>{match ? match.maxScore.toFixed(1) + '%' : '—'}</dd></div></dl>
            </section>
          </div>
          <div className="label-coordinates">
            <Coordinates title="目标位置" kind="target" value={target} onChange={(field, value) => changeRect('target', field, value)} />
            <Coordinates title="搜索范围" kind="range" value={range} onChange={(field, value) => changeRect('range', field, value)} />
          </div>
        </div>
      </section>

      {renderedReferencePanel}
    </div>
    </div>
    {!cornerLayout && <footer className="label-workspace-note" role="status">{notice || '截图后选择红框或绿框，在静态画面上拖动圈选。'}</footer>}
  </div>;
}

function LabelReference({ labels, filter, onFilterChange, loadLabel }: {
  labels: LabelRecord[];
  filter: string;
  onFilterChange: (value: string) => void;
  loadLabel: (item: LabelRecord) => void | Promise<void>;
}) {
  const filtered = labels.filter(label => label.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <div className="label-reference-section" aria-label="搜图标签与标注步骤">
    <section className="label-library" aria-label="搜图标签">
      <header className="label-section-heading"><h4><Tag size={14} />搜图标签</h4><span>{labels.length}</span></header>
      <div className="label-list-search"><Search size={13} /><input type="search" aria-label="搜索图像标签" placeholder="搜索标签…" value={filter} onChange={event => onFilterChange(event.target.value)} /></div>
      <div className="label-library-items" aria-label="标签列表" tabIndex={0}>
        {filtered.length ? filtered.map(label => <button className="label-library-item" key={label.path} onDoubleClick={() => void loadLabel(label)} onClick={() => void loadLabel(label)}><Tag size={14} /><span>{label.name}</span></button>) : <div className="label-library-empty"><Tags size={24} /><strong>还没有标签</strong><span>保存后在这里选择标签</span></div>}
      </div>
      <p className="label-library-hint">双击标签可加载到画布</p>
    </section>
    <section className="label-instructions" aria-label="标注说明">
      <header className="label-section-heading"><h4><CircleHelp size={14} />标注步骤</h4></header>
      <ol>
        <li><span>01</span><div><strong>截取画面</strong><p>从右上角实时画面截图，左侧保留静态帧。</p></div></li>
        <li><span className="range">02</span><div><strong>圈选搜索范围</strong><p>用红框限定在哪一片区域搜索。</p></div></li>
        <li><span className="target">03</span><div><strong>圈选搜索目标</strong><p>用绿框标出需要识别的图像。</p></div></li>
        <li><span>04</span><div><strong>测试并保存</strong><p>检查匹配结果，命名并保存标签。</p></div></li>
      </ol>
    </section>
  </div>;
}

function Coordinates({ title, kind, value, onChange }: { title: string; kind: SelectionKind; value: LabelRect; onChange: (field: keyof LabelRect, value: string) => void }) {
  const fields: [keyof LabelRect, string][] = [['x', 'X'], ['y', 'Y'], ['width', 'W'], ['height', 'H']];
  return <fieldset><legend><span className={'label-color-dot ' + kind} />{title}</legend><div>
    {fields.map(([field, label]) => <label key={field}><span>{label}</span><input type="number" aria-label={title + ' ' + label} min={0} value={value[field]} onChange={event => onChange(field, event.target.value)} /></label>)}
  </div></fieldset>;
}
