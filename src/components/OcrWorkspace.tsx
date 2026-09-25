import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ScanText, Target, WandSparkles } from 'lucide-react';
import { automationBusy, useAutomation, type OcrRegionRow } from '../automation';
import { useDevices } from '../useDevices';
import { containedPoint } from '../blink';

export type OcrRect = { x: number; y: number; width: number; height: number };

type OcrRow = {
  id: string;
  label: string;
  rect: OcrRect;
  visible: boolean;
  lastRecognition: string;
};

const initialRows: OcrRow[] = [
  { id: 'nature', label: '性格', rect: { x: 112, y: 203, width: 230, height: 64 }, visible: false, lastRecognition: '未测试' },
  { id: 'characteristic', label: '个性', rect: { x: 103, y: 569, width: 432, height: 64 }, visible: false, lastRecognition: '未测试' },
  { id: 'hp', label: 'HP', rect: { x: 517, y: 197, width: 54, height: 42 }, visible: false, lastRecognition: '未测试' },
  { id: 'attack', label: '攻击', rect: { x: 735, y: 315, width: 85, height: 64 }, visible: false, lastRecognition: '未测试' },
  { id: 'defense', label: '防御', rect: { x: 717, y: 478, width: 115, height: 54 }, visible: false, lastRecognition: '未测试' },
  { id: 'sp_attack', label: '特攻', rect: { x: 224, y: 306, width: 63, height: 67 }, visible: false, lastRecognition: '未测试' },
  { id: 'sp_defense', label: '特防', rect: { x: 218, y: 487, width: 85, height: 42 }, visible: false, lastRecognition: '未测试' },
  { id: 'speed', label: '速度', rect: { x: 475, y: 596, width: 85, height: 39 }, visible: false, lastRecognition: '未测试' },
  { id: 'shiny_dialog', label: '判闪对话区域', rect: { x: 6, y: 895, width: 1914, height: 175 }, visible: false, lastRecognition: '未测试' },
  { id: 'starter_battle', label: '御三家战斗区域', rect: { x: 1540, y: 620, width: 170, height: 95 }, visible: false, lastRecognition: '未测试' },
];

const cloneRows = () => initialRows.map(row => ({ ...row, rect: { ...row.rect } }));

export function OcrWorkspace({ overlayTarget, previewTarget }: { overlayTarget?: HTMLElement | null; previewTarget?: HTMLElement | null }) {
  const { api, snapshot, error, setError } = useAutomation();
  const { video } = useDevices();
  const sourceSize = { width: video.width || 1920, height: video.height || 1080 };
  const [rows, setRows] = useState<OcrRow[]>(cloneRows);
  const [pending, setPending] = useState(false), [notice, setNotice] = useState(''), [dirty, setDirty] = useState(false);
  const initialized = useRef(false);
  useEffect(() => {
    if (!snapshot || initialized.current) return;
    initialized.current = true;
    setRows(snapshot.config.ocr.map(row => ({ ...row, visible: false, lastRecognition: '未测试' })));
  }, [snapshot]);
  const busy = pending || automationBusy(snapshot?.state);
  const values = (items: OcrRow[]): OcrRegionRow[] => items.map(({ id, label, rect }) => ({ id, label, rect }));
  const perform = async (action: () => Promise<void>) => {
    setPending(true); setError(''); setNotice('');
    try { if (!api) throw Error('请在桌面应用中使用 OCR 服务'); await action(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  };
  const save = async (items = rows) => { await api!.saveOcr(values(items)); setDirty(false); };
  const [selectedId, setSelectedId] = useState(initialRows[0].id);
  const [warmed, setWarmed] = useState(false);
  const selectedRow = rows.find(row => row.id === selectedId) ?? rows[0];

  const updateSelectedRect = (rect: OcrRect) => {
    setDirty(true);
    setRows(current => current.map(row => row.id === selectedId ? { ...row, rect } : row));
  };
  const selectRow = (id: string) => setSelectedId(id);
  const toggleVisible = (id: string) => {
    setRows(current => current.map(row => row.id === id ? { ...row, visible: !row.visible } : row));
    setSelectedId(id);
  };
  const beginSelection = (id: string) => {
    setSelectedId(id);
    setRows(current => current.map(row => row.id === id ? { ...row, visible: true } : row));
  };
  const resetRow = (id: string) => {
    const original = initialRows.find(row => row.id === id);
    if (!original) return;
    setSelectedId(id);
    setRows(current => current.map(row => row.id === id ? { ...original, rect: { ...original.rect } } : row));
    setDirty(true);
  };
  const recognizeRow = (id: string) => {
    setSelectedId(id);
    void perform(async () => {
      await save();
      setRows(current => current.map(row => row.id === id ? { ...row, lastRecognition: '识别中…' } : row));
      try {
        const result = await api!.ocr({ operation: 'field', field: id });
        setRows(current => current.map(row => row.id === id ? { ...row, lastRecognition: result.text || '未识别' } : row));
      } catch (error) {
        setRows(current => current.map(row => row.id === id ? { ...row, lastRecognition: '识别失败' } : row)); throw error;
      }
    });
  };
  const testAll = () => {
    void perform(async () => {
      await save(); const result = await api!.ocr({ operation: 'test-all' });
      setRows(current => current.map(row => result.results?.[row.id] === undefined ? row : { ...row, lastRecognition: result.results[row.id] }));
      setNotice(result.text || '测试全部完成');
    });
  };
  const warmup = () => { void perform(async () => { await api!.ocr({ operation: 'warmup' }); setWarmed(true); }); };
  const resetAll = () => {
    void perform(async () => {
      const defaults = await api!.defaultOcr();
      await api!.saveOcr(defaults);
      setRows(defaults.map(row => ({ ...row, visible: false, lastRecognition: '未测试' }))); setDirty(false);
      setSelectedId(initialRows[0].id);
    });
  };

  const visibleRows = useMemo(() => rows.filter(row => row.visible), [rows]);

  return <section className="ocr-workspace" aria-label="闪光反查区域工作区">
    <div className="ocr-settings-content">
      <header className="ocr-workspace-heading">
        <div><ScanText size={17} /><div><h2>闪光反查区域</h2><p>设置反查所需的识别范围，在右侧视频中框选或预览对应区域。</p></div></div>
        <span className="ocr-source-badge">源画面 · {sourceSize.width} × {sourceSize.height}</span>
      </header>
      {(error || notice) && <p role={error ? 'alert' : 'status'}>{error || notice}</p>}
      <p className="muted">测试全部：请先停在训练家笔记页，将自动向右翻到能力页。判闪对话和战斗区域请单独测试。</p>
      <div className="automation-fields">{(['x','y','width','height'] as const).map(key => <label key={key}>{key}<input type="number" min={key === 'x' || key === 'y' ? 0 : 1} value={selectedRow.rect[key]} disabled={busy} onChange={event => updateSelectedRect({ ...selectedRow.rect, [key]: Number(event.target.value) })} /></label>)}</div>

      <section className="ocr-settings-card ocr-region-card" aria-label="反查识别区域">
        <header className="ocr-region-heading">
          <div className="ocr-card-heading"><Target size={15} /><h3>识别项目与区域</h3><span className="ocr-region-count">{rows.length} 个项目 · 当前选中：{selectedRow.label}</span></div>
          <span className="ocr-table-hint">点击“框选”后，在右侧视频拖动设置区域</span>
        </header>
        <div className="ocr-table-wrap">
          <table className="ocr-table">
            <thead><tr><th scope="col">项目</th><th scope="col">区域</th><th scope="col">状态</th><th scope="col">操作</th><th scope="col">上次识别</th></tr></thead>
            <tbody>
              {rows.map(row => <tr key={row.id} className={row.id === selectedId ? 'is-selected' : undefined} onClick={() => selectRow(row.id)}>
                <td><button className="ocr-row-name" type="button" onClick={() => selectRow(row.id)}>{row.label}</button></td>
                <td><code>{row.rect.x}, {row.rect.y}, {row.rect.width}, {row.rect.height}</code></td>
                <td><span className="ocr-status is-visible">已设置</span></td>
                <td><div className="ocr-row-actions">
                  <button type="button" onClick={() => beginSelection(row.id)}>框选</button>
                  <button type="button" aria-pressed={row.visible} onClick={() => toggleVisible(row.id)}>{row.visible ? '隐藏' : '显示'}</button>
                  <button type="button" disabled={busy} onClick={() => recognizeRow(row.id)}>识别</button>
                  <button type="button" onClick={() => resetRow(row.id)}>重置</button>
                </div></td>
                <td><span className="ocr-last-result">{row.lastRecognition}</span></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <footer className="ocr-region-footer">
          <button className="button" type="button" onClick={warmup} disabled={busy || warmed}>{warmed ? 'OCR 已预热' : '预热 OCR'}</button><span>{warmed ? 'OCR 引擎已准备' : '首次识别或自动流程启动时按需加载模型'}</span>
          <span className="ocr-footer-spacer" />
          <button className="button" type="button" disabled={busy} onClick={() => void perform(async () => { await save(); setNotice('区域已保存'); })}>{dirty ? '保存区域 *' : '保存区域'}</button>
          <button className="button" type="button" disabled={busy} onClick={() => recognizeRow(selectedId)}>测试当前项</button>
          <button className="button primary" type="button" disabled={busy} onClick={testAll}>测试全部</button>
          <button className="button" type="button" disabled={busy} onClick={resetAll}>导入默认区域</button>
        </footer>
      </section>
    </div>
    {overlayTarget && !busy && createPortal(<OcrRoiOverlay rows={visibleRows} selectedId={selectedId} setRect={updateSelectedRect} sourceSize={sourceSize} />, overlayTarget)}
    {previewTarget && createPortal(<OcrPreviewPanel row={selectedRow} />, previewTarget)}
  </section>;
}

function OcrRoiOverlay({ rows, selectedId, setRect, sourceSize }: { rows: OcrRow[]; selectedId: string; setRect: (next: OcrRect) => void; sourceSize: { width: number; height: number } }) {
  const svg = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const point = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return containedPoint(event.clientX, event.clientY, rect, sourceSize.width, sourceSize.height, true) || { x: 0, y: 0 };
  };
  const update = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const current = point(event);
    setRect({ x: Math.round(Math.min(drag.current.x, current.x)), y: Math.round(Math.min(drag.current.y, current.y)), width: Math.max(1, Math.round(Math.abs(current.x - drag.current.x))), height: Math.max(1, Math.round(Math.abs(current.y - drag.current.y))) });
  };
  const begin = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    svg.current?.setPointerCapture(event.pointerId);
    drag.current = point(event);
  };
  const end = (event: ReactPointerEvent<SVGSVGElement>) => {
    update(event);
    drag.current = null;
    if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId);
  };
  return <div className="video-roi-overlay" aria-label="反查识别区域框选">
    <svg ref={svg} viewBox={`0 0 ${sourceSize.width} ${sourceSize.height}`} preserveAspectRatio="xMidYMid meet" onPointerDown={begin} onPointerMove={update} onPointerUp={end} onPointerCancel={end}>
      {rows.map(row => <rect key={row.id} className={row.id === selectedId ? 'ocr-roi-selection is-active' : 'ocr-roi-selection'} x={row.rect.x} y={row.rect.y} width={row.rect.width} height={row.rect.height} />)}
    </svg>
  </div>;
}

function OcrPreviewPanel({ row }: { row: OcrRow }) {
  const waiting = row.lastRecognition === '未测试';
  return <section className="ocr-preview-panel" aria-label="反查识别预览">
    <header className="ocr-preview-heading"><WandSparkles size={15} /><h2>识别预览 · {row.label}</h2><span>{waiting ? '待测试' : '已完成'}</span></header>
    <div className="ocr-preview-text">{waiting ? '尚未执行识别' : row.lastRecognition}</div>
    <dl className="ocr-preview-meta"><div><dt>区域</dt><dd>{row.rect.width} × {row.rect.height}</dd></div><div><dt>状态</dt><dd>{waiting ? '—' : '待确认'}</dd></div></dl>
  </section>;
}
