import { useEffect, useRef, useState } from 'react';
import type { Snapshot, VideoState } from './devices';

export type BlinkRect = { x: number; y: number; width: number; height: number };
export type BlinkMode = 'recover' | 'reidentify' | 'munchlax';
export type BlinkConfig = {
  name: string; mode: BlinkMode; eye: string; eyeRect: BlinkRect | null; roi: BlinkRect | null;
  sourceWidth: number; sourceHeight: number; threshold: number; npc: number; noisy: boolean;
  seed: string[]; searchMin: number; searchMax: number;
  timeDelay: number; advanceDelay: number; advanceDelay2: number; timelineNpc: number; pokemonNpc: number; menuClose: boolean;
};
export type BlinkResult = { words: string[]; pair: string[]; matchedAdvance: number | null; mode: BlinkMode; capturedAt: number; blinks: number[]; intervals: number[]; baselineAdvances?: number; rawWords?: string[] };
export type BlinkTracking = { words: string[]; pair: string[]; advances: number; phase: 'tracking' | 'munchlax' | 'countdown' | 'delay' | 'timeline'; countdown: number | null; nextIn: number };
export type BlinkState = {
  revision: number; runId?: string; mode?: BlinkMode | 'preview'; status: 'idle' | 'starting' | 'preview' | 'capturing' | 'solving' | 'tracking' | 'countdown' | 'timeline' | 'stopping' | 'stopped' | 'completed' | 'error';
  captured: number; target: number; message: string; score?: number | null; location?: BlinkRect; skipped?: number;
  blinks?: number[]; intervals?: number[]; result?: BlinkResult | null;
  tracking?: BlinkTracking | null;
};
export type BlinkObservation = { score?: number; location?: BlinkRect; error?: string };
export type BlinkRequest = Omit<BlinkConfig, 'mode'> & { mode: BlinkMode | 'preview' };
export interface BlinkApi {
  getState: () => Promise<BlinkState>;
  start: (config: BlinkRequest) => Promise<BlinkState>;
  stop: () => Promise<BlinkState>;
  timeline: () => Promise<BlinkState>;
  observe: (config: BlinkRequest | null) => Promise<void>;
  importConfig: () => Promise<Partial<BlinkConfig> | null>;
  onState: (listener: (state: BlinkState) => void) => () => void;
  onObservation: (listener: (observation: BlinkObservation) => void) => () => void;
}
export type BlinkSelection = { kind: 'eye' | 'roi'; frame: Snapshot };
export const blinkBusy = (state: BlinkState) => ['starting', 'preview', 'capturing', 'solving', 'tracking', 'countdown', 'timeline', 'stopping'].includes(state.status);
const fixedSearchRange = { searchMin: 0, searchMax: 1_000_000 };
export const newBlinkConfig = (): BlinkConfig => ({ name: '默认', mode: 'recover', eye: '', eyeRect: null, roi: null,
  sourceWidth: 0, sourceHeight: 0, threshold: 0.9, npc: 0, noisy: false, seed: ['', '', '', ''], ...fixedSearchRange,
  timeDelay: 0, advanceDelay: 0, advanceDelay2: 0, timelineNpc: 0, pokemonNpc: 0, menuClose: true });
const storageKey = 'auto-poke-rng:bdsp-blink-configs';
function loadConfigs(): BlinkConfig[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(value => value && typeof value.name === 'string' && typeof value.eye === 'string'
      && ['recover', 'reidentify', 'munchlax'].includes(value.mode) && Array.isArray(value.seed) && value.seed.length === 4)
      .slice(0, 20).map(value => ({ ...newBlinkConfig(), ...value, ...fixedSearchRange }));
  } catch { return []; }
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export function containedPoint(clientX: number, clientY: number, bounds: { left: number; top: number; width: number; height: number }, width: number, height: number, clamp = false) {
  const scale = Math.min(bounds.width / width, bounds.height / height);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const x = (clientX - bounds.left - (bounds.width - width * scale) / 2) / scale;
  const y = (clientY - bounds.top - (bounds.height - height * scale) / 2) / scale;
  if (!clamp && (x < 0 || y < 0 || x > width || y > height)) return null;
  return { x: Math.max(0, Math.min(width, Math.round(x))), y: Math.max(0, Math.min(height, Math.round(y))) };
}

async function cropEye(frame: Snapshot, rect: BlinkRect) {
  if (rect.width > 512 || rect.height > 512) throw Error('眼睛模板请紧贴睁开的眼睛，宽高不超过 512 像素。');
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(Error('截图读取失败。')); image.src = frame.url; });
  if (image.naturalWidth !== frame.width || image.naturalHeight !== frame.height) throw Error('截图尺寸不一致，请重试。');
  const canvas = document.createElement('canvas'); canvas.width = rect.width; canvas.height = rect.height;
  const context = canvas.getContext('2d');
  if (!context) throw Error('无法读取截图。');
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return canvas.toDataURL('image/png');
}

export function useBlink(video: VideoState, enabled: boolean, viewActive = false) {
  const [configs, setConfigs] = useState(loadConfigs);
  const [config, setConfig] = useState<BlinkConfig>(() => configs[0] || newBlinkConfig());
  const [state, setState] = useState<BlinkState>({ revision: 0, status: 'idle', captured: 0, target: 40, message: '等待捕获' });
  const [observation, setObservation] = useState<BlinkObservation | null>(null);
  const [selection, setSelection] = useState<BlinkSelection | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [notice, setNotice] = useState('');
  const selectionVersion = useRef(0);
  const suppressContextMenuUntil = useRef(0);
  const currentVideo = useRef(video); currentVideo.current = video;
  const active = useRef(enabled); active.current = enabled;
  const busy = blinkBusy(state);
  const matchingInJob = ['starting', 'preview', 'capturing', 'solving', 'stopping'].includes(state.status);
  const api = window.desktop?.blink;
  const lastResult = useRef<BlinkResult | null>(null);
  useEffect(() => {
    if (state.result && state.result !== lastResult.current) {
      // A running snapshot carries the same result by value over IPC. Use the
      // capture identity so live clock updates do not reset manually edited seeds.
      if (state.result.capturedAt !== lastResult.current?.capturedAt || state.result.pair.join() !== lastResult.current?.pair.join()) {
        setConfig(current => ({ ...current, seed: [...state.result!.words] }));
      }
      lastResult.current = state.result;
    }
  }, [state.result]);
  useEffect(() => {
    if (!api) return;
    let alive = true;
    const update = (value: BlinkState) => { if (alive) setState(previous => value.revision >= previous.revision ? value : previous); };
    const unsubscribe = api.onState(update);
    void api.getState().then(update).catch(() => {});
    return () => { alive = false; unsubscribe(); };
  }, [api]);
  useEffect(() => api?.onObservation(value => setObservation(value)), [api]);
  useEffect(() => {
    if (!api || !viewActive || !enabled || matchingInJob || selection || selecting || video.status !== 'connected'
        || !config.eye || !config.roi || config.sourceWidth !== video.width || config.sourceHeight !== video.height) {
      setObservation(null);
      return;
    }
    setObservation(null);
    let active = true;
    void api.observe({ ...config, mode: 'preview' }).catch(error => { if (active) setObservation({ error: errorMessage(error) }); });
    return () => { active = false; void api.observe(null).catch(() => {}); };
  }, [api, viewActive, enabled, matchingInJob, selection, selecting, video.status, video.session, video.width, video.height,
    config.eye, config.roi, config.sourceWidth, config.sourceHeight, config.threshold]);
  useEffect(() => {
    ++selectionVersion.current; setSelection(null); setSelecting(false);
  }, [enabled, video.session, video.status]);
  useEffect(() => {
    if (!enabled && busy) void api?.stop().catch(() => {});
  }, [enabled, busy, api]);
  const cancelSelection = () => { ++selectionVersion.current; setSelection(null); setSelecting(false); };
  const beginSelection = async (kind: BlinkSelection['kind']) => {
    if (busy || !enabled) return;
    const version = ++selectionVersion.current;
    setSelecting(true); setNotice('');
    try {
      const capture = window.desktop?.devices?.video;
      if (!capture || video.status !== 'connected') throw Error('请先连接视频源。');
      const frame = await capture.snapshot();
      if (version !== selectionVersion.current || !active.current) return;
      if (frame.session !== currentVideo.current.session) throw Error('视频源已切换，请重新框选。');
      setSelection({ kind, frame });
    } catch (error) { if (version === selectionVersion.current) setNotice(errorMessage(error)); }
    finally { if (version === selectionVersion.current) setSelecting(false); }
  };
  const finishSelection = async (rect: BlinkRect) => {
    if (!selection) return;
    suppressContextMenuUntil.current = performance.now() + 500;
    const version = selectionVersion.current;
    const { frame, kind } = selection;
    if (rect.width < 2 || rect.height < 2) { setNotice('请选择至少 2 × 2 像素的区域。'); return; }
    try {
      const eye = kind === 'eye' ? await cropEye(frame, rect) : null;
      if (version !== selectionVersion.current || frame.session !== currentVideo.current.session) return;
      setConfig(previous => {
        const resized = previous.sourceWidth !== frame.width || previous.sourceHeight !== frame.height;
        return { ...previous, sourceWidth: frame.width, sourceHeight: frame.height,
          ...(resized ? { eye: '', eyeRect: null, roi: null } : {}),
          ...(eye !== null ? { eye, eyeRect: rect } : { roi: rect }) };
      });
      setSelection(null);
      setNotice(kind === 'eye' ? '已截取睁眼模板' : '已设置识别 ROI');
    } catch (error) { setNotice(errorMessage(error)); }
  };
  const run = async (mode: BlinkMode = config.mode) => {
    if (!api || busy || selection || selecting) return;
    setNotice('');
    const parameters = { ...config, mode, ...fixedSearchRange, ...(mode === 'reidentify' && config.noisy ? { pokemonNpc: 1 } : {}) };
    setConfig(current => ({ ...current, ...parameters, mode }));
    try { await api.start(parameters); }
    catch (error) { setNotice(errorMessage(error)); }
  };
  const stop = async () => { try { await api?.stop(); } catch (error) { setNotice(errorMessage(error)); } };
  const timeline = async () => { setNotice(''); try { await api?.timeline(); } catch (error) { setNotice(errorMessage(error)); } };
  const importConfig = async () => {
    if (!api || busy) return;
    const version = selectionVersion.current;
    try {
      const imported = await api.importConfig();
      if (!imported || version !== selectionVersion.current || !active.current) return;
      setConfig({ ...newBlinkConfig(), ...imported, ...fixedSearchRange });
      setNotice(imported.eye && imported.roi ? '已导入原版配置，请在右上角视频核对实时识别结果后保存。' : '参数已导入，请在当前视频重新框选模板与 ROI 后保存。');
    } catch (error) { setNotice(errorMessage(error)); }
  };
  const save = () => {
    const name = config.name.trim();
    if (!name) { setNotice('请输入配置名称。'); return; }
    const saved = { ...config, name, ...fixedSearchRange };
    const next = [saved, ...configs.filter(item => item.name !== name)].slice(0, 20);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setConfigs(next); setConfig(saved); setNotice('配置已保存'); }
    catch { setNotice('配置保存失败，本地存储空间不足。'); }
  };
  return { configs, config, setConfig, state, observation, busy, selection, selecting, notice, setNotice, beginSelection, cancelSelection, finishSelection,
    suppressVideoContextMenu: () => performance.now() < suppressContextMenuUntil.current, run, stop, save, timeline, importConfig };
}
export type BlinkController = ReturnType<typeof useBlink>;
