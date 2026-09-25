import { useEffect, useState } from 'react';
import { FileClock, MonitorPlay, PanelRightClose, Pin, PinOff } from 'lucide-react';
import type { PanelTool } from './desktop';
import { usePanelWindows } from './usePanelWindows';
import { LogsPanel } from './components/LogsPanel';
import { VideoPreview, VideoLabelsButton } from './components/VideoPreview';

export function DetachedPanel({ tool }: { tool: PanelTool }) {
  const { state, setLogSource, setVideoLabelsOpen, error, setError } = usePanelWindows();
  const [platform, setPlatform] = useState('win32');
  const [labelFolder, setLabelFolder] = useState(() => localStorage.getItem('auto-poke-rng:label-folder') || '');
  useEffect(() => {
    const syncFolder = () => setLabelFolder(localStorage.getItem('auto-poke-rng:label-folder') || '');
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'auto-poke-rng:label-folder') syncFolder();
    };
    window.addEventListener('storage', onStorage);
    syncFolder();
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const api = window.desktop?.panels;
  const title = tool === 'video' ? '视频预览' : '日志中心';
  useEffect(() => {
    document.title = title + ' · Auto Poke RNG';
    window.desktop?.getMetadata().then(data => setPlatform(data.platform)).catch(() => undefined);
  }, [title]);

  const perform = (operation: Promise<void> | undefined) => {
    setError('');
    void operation?.catch(() => setError('操作失败，请重试。'));
  };

  return <main className="detached-panel" data-platform={platform}>
    <header className="detached-panel-header">
      {tool === 'video' ? <MonitorPlay size={16} /> : <FileClock size={16} />}
      <h1>{title}</h1>
      <div className="floating-panel-actions">
        {tool === 'video' && <VideoLabelsButton expanded={state.videoLabelsOpen} toggle={() => setVideoLabelsOpen(!state.videoLabelsOpen)} />}
        <button className="icon-button" title="收回主窗口" aria-label="收回主窗口" onClick={() => perform(api?.dock())}><PanelRightClose size={15} /></button>
        <button className="icon-button" title={state.alwaysOnTop ? '取消置顶' : '窗口置顶'} aria-label={state.alwaysOnTop ? '取消置顶' : '窗口置顶'} aria-pressed={state.alwaysOnTop} onClick={() => perform(api?.setAlwaysOnTop(!state.alwaysOnTop))}>
          {state.alwaysOnTop ? <PinOff size={15} /> : <Pin size={15} />}
        </button>
      </div>
    </header>
    <div className="floating-panel-body">
      {error && <p className="panel-error" role="alert">{error}</p>}
      {tool === 'video' ? <VideoPreview labelsOpen={state.videoLabelsOpen} labelFolder={labelFolder} /> : <LogsPanel logs={state.logs} source={state.logSource} setSource={setLogSource} clear={() => perform(api?.clearLogs())} />}
    </div>
  </main>;
}
