import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Check, ChevronDown, CircleHelp, FileClock, Gamepad2, Home, Keyboard,
  MonitorPlay, PanelLeftClose, PanelLeftOpen, Search, Settings, TerminalSquare, Tv,
} from 'lucide-react';
import { CommandPalette, type CommandAction } from './components/CommandPalette';
import { LogsPanel } from './components/LogsPanel';
import { FloatingSidePanel, type PanelState, type PanelTool } from './components/FloatingSidePanel';
import { ScriptWorkspace } from './components/ScriptWorkspace';
import { ScriptLibrary } from './components/ScriptLibrary';
import { QuickTools } from './components/QuickTools';
import { ToolsDialog } from './components/Tools';
import { VideoPreview, VideoLabelsButton } from './components/VideoPreview';
import { createLog, games, type GameId, type LogEntry, type Modal, type Page } from './workspace';
import { usePanelWindows } from './usePanelWindows';
import { useScriptLibrary } from './useScriptLibrary';
import { parentFolder, scriptError } from './scriptLibrary';
import { GlobalTools, initialConnections, type DeviceConnections } from './components/GlobalTools';
import { VirtualControllerWindow } from './components/VirtualControllerWindow';
import { ControllerOverlayApp } from './components/ControllerOverlayApp';
import { KeyMappingDialog } from './components/KeyMappingDialog';
import { loadControllerMapping, type MappingAction } from './controllerMapping';
import { useDevices } from './useDevices';

export default function App({ connections = initialConnections }: { connections?: DeviceConnections }) {
  if (new URLSearchParams(window.location.search).get('window') === 'controller-overlay') {
    return <div className="controller-overlay-root"><ControllerOverlayApp /></div>;
  }
  const devices = useDevices();
  const actualConnections = window.desktop?.devices ? { video: devices.video.status, controller: devices.controller.status } : connections;
  const [page, setPage] = useState<Page>('脚本编辑');
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [game, setGame] = useState<GameId>('frlg');
  const [gameMenuOpen, setGameMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [run, setRun] = useState<{ folder: string; scriptName: string; started: number } | null>(null);
  const startingRun = useRef<Promise<unknown> | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const library = useScriptLibrary();
  const { save: saveScript } = library;
  const [logs, setLogs] = useState<LogEntry[]>(() => [createLog('工作区已就绪，等待运行脚本。')]);
  const [modal, setModal] = useState<Modal | null>(null);
  const [virtualControllerOpen, setVirtualControllerOpen] = useState(false);
  const mappingOpening = useRef(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toolPanel, setToolPanel] = useState<PanelState | null>(null);
  const [detaching, setDetaching] = useState(false);
  const { state: panelWindows, setLogSource, setVideoLabelsOpen, error: panelError } = usePanelWindows();
  const nativePanels = window.desktop?.panels;
  const [unread, setUnread] = useState(true);
  const [version, setVersion] = useState('0.1.0');
  const [toast, setToast] = useState('');
  const switcher = useRef<HTMLDivElement>(null);
  const gameButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const dockButtons = useRef<Partial<Record<PanelTool, HTMLButtonElement | null>>>({});
  const activeGame = games.find(item => item.id === game)!;
  const script = library.active?.body || '';
  const saved = library.saved;
  const overlayApi = window.desktop?.overlay;
  const scriptRef = useRef(script);
  const recordingRef = useRef(false);
  const recordingClock = useRef(0);
  const recordedDirections = useRef({ LS: new Set<string>(), RS: new Set<string>(), hat: new Set<string>() });
  scriptRef.current = script;

  useEffect(() => {
    if (!overlayApi) return;
    let alive = true;
    void overlayApi.getState().then(value => { if (alive) setVirtualControllerOpen(value.visible); }).catch(() => {});
    const unsubscribe = overlayApi.onState(value => {
      if (!alive) return;
      setVirtualControllerOpen(value.visible);
      if (!value.active && recordingRef.current) {
        recordingRef.current = false;
        setRecording(false);
      }
    });
    void overlayApi.setMapping(loadControllerMapping()).catch(() => {});
    const savedScale = Number(localStorage.getItem('auto-poke-rng:controller-overlay-scale'));
    if (savedScale) void overlayApi.setScale(savedScale).catch(() => {});
    return () => { alive = false; unsubscribe(); };
  }, [overlayApi]);

  const addLog = useCallback((message: string, source: LogEntry['source'] = '系统', level: LogEntry['level'] = 'info') => {
    setLogs(entries => [...entries, createLog(message, source, level)].slice(-500));
  }, []);

  useEffect(() => window.desktop?.devices?.onEvent(event => {
    if (event.event === 'script.started') addLog('脚本已通过预检，开始执行。', '脚本', 'success');
    if (event.event === 'script.log' && event.message) addLog(event.message, '脚本');
    if (event.event === 'script.done') {
      setRun(current => { if (current) setElapsed(Math.floor((Date.now() - current.started) / 1000)); return null; });
      addLog(event.status === 'completed' ? '脚本执行完成，伊机控保持连接。' : event.status === 'cancelled' ? '脚本已停止，按键已释放。' : '脚本执行失败：' + event.message, '脚本', event.status === 'failed' ? 'warning' : 'info');
    }
  }), [addLog]);

  const appendRecordedCommands = useCallback((commands: string[], timestamp: number) => {
    if (!commands.length || !library.active) return;
    const wait = recordingClock.current ? Math.max(0, Math.round(timestamp - recordingClock.current)) : 0;
    const lines = [...(wait > 0 ? [`WAIT ${wait}`] : []), ...commands];
    const current = scriptRef.current;
    const body = (current && !current.endsWith('\n') ? current + '\n' : current) + lines.join('\n') + '\n';
    scriptRef.current = body;
    library.update({ body });
    recordingClock.current = timestamp;
  }, [library]);

  useEffect(() => {
    if (!overlayApi) return;
    return overlayApi.onInput(value => {
      if (!recordingRef.current) return;
      const event = value as { action?: MappingAction; down?: boolean; timestamp?: number };
      const action = event.action;
      if (!action) return;
      const down = Boolean(event.down);
      const timestamp = Number(event.timestamp) || Date.now();
      if (action.kind === 'button') {
        appendRecordedCommands([`${action.key.replaceAll('_', '')} ${down ? 'DOWN' : 'UP'}`], timestamp);
        return;
      }
      const directions = recordedDirections.current[action.side];
      if (down) directions.add(action.direction); else directions.delete(action.direction);
      const up = directions.has('UP'), downDirection = directions.has('DOWN');
      const left = directions.has('LEFT'), right = directions.has('RIGHT');
      const vertical = up && !downDirection ? 'UP' : downDirection && !up ? 'DOWN' : '';
      const horizontal = left && !right ? 'LEFT' : right && !left ? 'RIGHT' : '';
      appendRecordedCommands([`${action.side} ${vertical}${horizontal || (vertical ? '' : 'RESET')}`], timestamp);
    });
  }, [appendRecordedCommands, overlayApi]);

  const openModal = (next: Modal) => {
    setGameMenuOpen(false);
    if (next === 'notification') setUnread(false);
    if (next === 'mapping' && overlayApi) {
      if (mappingOpening.current || modal === 'mapping') return;
      mappingOpening.current = true;
      void overlayApi.suspend().then(() => setModal(next))
        .catch(error => setToast('无法暂停键盘控制：' + error.message))
        .finally(() => { mappingOpening.current = false; });
      return;
    }
    setModal(next);
  };

  const closeModal = () => {
    if (modal === 'mapping' && overlayApi) {
      void overlayApi.resume().catch(error => setToast('无法恢复虚拟手柄：' + error.message));
    }
    setModal(null);
    if (modal === 'settings') requestAnimationFrame(() => settingsButton.current?.focus());
  };

  const toggleVirtualController = useCallback(async () => {
    if (devices.controller.status !== 'connected') {
      setToast('请先在左上角“伊机控”中连接单片机。');
      return;
    }
    if (overlayApi) await overlayApi.toggle();
    else setVirtualControllerOpen(value => !value);
  }, [devices.controller.status, overlayApi]);

  const showPanel = (tool: PanelTool) => {
    if (panelWindows.detached.includes(tool)) {
      void nativePanels?.open(tool).catch(() => setToast('无法打开独立窗口，请重试。'));
      return;
    }
    setToolPanel(current => ({ tool, minimized: false, expanded: current?.expanded ?? false }));
  };

  const togglePanel = (tool: PanelTool) => {
    if (panelWindows.detached.includes(tool)) { showPanel(tool); return; }
    setToolPanel(current => ({ tool, minimized: current?.tool === tool && !current.minimized, expanded: current?.expanded ?? false }));
  };

  const closePanel = () => {
    if (toolPanel) dockButtons.current[toolPanel.tool]?.focus();
    setToolPanel(null);
  };

  const minimizePanel = () => {
    if (toolPanel) dockButtons.current[toolPanel.tool]?.focus();
    setToolPanel(current => current && { ...current, minimized: true });
  };

  const detachPanel = async () => {
    if (!toolPanel || !nativePanels || detaching) return;
    const tool = toolPanel.tool;
    setDetaching(true);
    try {
      await nativePanels.open(tool);
      setToolPanel(current => current?.tool === tool ? null : current);
    } catch { setToast('弹出窗口失败，面板仍保留在当前工作区。'); }
    finally { setDetaching(false); }
  };

  useEffect(() => nativePanels?.onAction(action => {
    if (action.type === 'clear-logs') setLogs([]);
    if (action.type === 'dock') setToolPanel(current => ({ tool: action.tool, minimized: false, expanded: current?.expanded ?? false }));
  }), [nativePanels]);

  useEffect(() => {
    void nativePanels?.publishLogs(logs).catch(() => setToast('独立窗口的日志同步失败，请重新打开窗口。'));
  }, [logs, nativePanels]);

  const saveDraft = useCallback(async () => {
    try {
      if (await saveScript()) setToast('脚本已保存到文件');
    } catch (error) {
      setToast('保存失败：' + scriptError(error));
      addLog('脚本保存失败，编辑内容仍保留在当前窗口。', '脚本', 'warning');
    }
  }, [addLog, saveScript]);

  useEffect(() => {
    window.desktop?.getMetadata().then(data => setVersion(data.version)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!run) return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - run.started) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [run]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !modal) {
        event.preventDefault();
        setGameMenuOpen(false);
        setPaletteOpen(value => !value);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && page === '脚本编辑' && !modal && !paletteOpen) {
        event.preventDefault();
        saveDraft();
      }
      if (event.key === 'Escape' && gameMenuOpen) {
        setGameMenuOpen(false);
        gameButton.current?.focus();
      }
    };
    const outsideClick = (event: PointerEvent) => {
      if (!switcher.current?.contains(event.target as Node)) setGameMenuOpen(false);
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('pointerdown', outsideClick);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('pointerdown', outsideClick);
    };
  }, [gameMenuOpen, modal, page, paletteOpen, saveDraft]);

  useEffect(() => {
    if (gameMenuOpen) switcher.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [gameMenuOpen]);

  const toggleRunning = () => {
    const api = window.desktop?.devices?.execution;
    if (api) {
      if (run) {
        void Promise.resolve(startingRun.current).then(() => api.stop()).catch(error => { setToast(error.message); addLog(error.message, '脚本', 'warning'); });
      } else if (library.active && !startingRun.current) {
        const start = async () => {
          if (overlayApi) await overlayApi.setActive(false);
          const folder = parentFolder(library.active!.path) || 'scripts';
          setElapsed(0); setRun({ folder, scriptName: library.active!.name, started: Date.now() });
          addLog(folder + ' · ' + library.active!.name + '：准备执行。', '脚本');
          const pending = api.start({ text: scriptRef.current, path: library.active!.path });
          startingRun.current = pending;
          try { await pending; } catch (error) { setRun(null); setToast(error instanceof Error ? error.message : String(error)); addLog(error instanceof Error ? error.message : String(error), '脚本', 'warning'); }
          finally { startingRun.current = null; }
        };
        void start().catch(error => { setRun(null); setToast(error instanceof Error ? error.message : String(error)); addLog(error instanceof Error ? error.message : String(error), '脚本', 'warning'); });
      }
      return;
    }
    if (run) {
      setElapsed(Math.floor((Date.now() - run.started) / 1000));
      setRun(null);
      addLog('运行演示已停止。', '脚本');
    } else if (library.active) {
      setElapsed(0);
      const scriptName = library.active.name.trim() || '未命名脚本';
      const folder = parentFolder(library.active.path) || 'scripts';
      setRun({ folder, scriptName, started: Date.now() });
      addLog(folder + ' · ' + scriptName + '：开始运行演示，不向设备发送操作。', '脚本', 'success');
    }
  };

  const toggleRecording = () => {
    if (!recording) {
      const start = async () => {
        if (overlayApi && !(await overlayApi.getState()).active) {
          addLog('请先启用虚拟手柄，再开始录制。', '手柄', 'warning');
          return;
        }
        recordingRef.current = true;
        setRecording(true);
        recordingClock.current = 0;
        recordedDirections.current = { LS: new Set(), RS: new Set(), hat: new Set() };
        await window.desktop?.devices?.controller.reset().catch(() => {});
        addLog('开始录制，虚拟手柄输入会按时间写入当前脚本。', '手柄');
      };
      void start().catch(error => addLog(error instanceof Error ? error.message : String(error), '手柄', 'warning'));
      return;
    }
    recordingRef.current = false;
    setRecording(false);
    recordingClock.current = 0;
    recordedDirections.current = { LS: new Set(), RS: new Set(), hat: new Set() };
    void window.desktop?.devices?.controller.reset().catch(() => {});
    addLog('录制完成，输入已写入当前脚本。', '手柄');
  };

  const actions: CommandAction[] = [
    { label: '首页', keywords: 'home', icon: <Home size={16} />, run: () => setPage('首页') },
    { label: '脚本编辑', keywords: 'script editor', icon: <TerminalSquare size={16} />, run: () => setPage('脚本编辑') },
    { label: '视频预览', keywords: 'video preview', icon: <MonitorPlay size={16} />, run: () => showPanel('video') },
    { label: '日志中心', keywords: 'logs history', icon: <FileClock size={16} />, run: () => showPanel('logs') },
    { label: '视频源', keywords: 'tv source', icon: <Tv size={16} />, run: () => openModal('video') },
    { label: '虚拟手柄', keywords: 'controller gamepad', icon: <Gamepad2 size={16} />, run: () => void toggleVirtualController() },
    { label: '按键映射', keywords: 'keyboard mapping', icon: <Keyboard size={16} />, run: () => openModal('mapping') },
    { label: '脚本编辑帮助', keywords: 'help', icon: <CircleHelp size={16} />, run: () => openModal('help') },
    { label: '设置', keywords: 'settings preferences', icon: <Settings size={16} />, run: () => openModal('settings') },
  ];

  return (
    <div className="app-shell" data-collapsed={collapsed} data-desktop={Boolean(window.desktop)}>
      <aside className="sidebar" aria-label="功能导航">
        <div className="sidebar-top">
          <div className="workspace-switcher" ref={switcher}>
            <button ref={gameButton} className="workspace-button" title={activeGame.label + ' · ' + activeGame.detail} aria-label={'切换游戏：' + activeGame.label} aria-expanded={gameMenuOpen} aria-controls="game-menu" aria-haspopup="menu" onClick={() => setGameMenuOpen(value => !value)}>
              <span className="game-mark" style={{ background: activeGame.color }} />
              <strong>{activeGame.label}</strong><ChevronDown size={13} />
            </button>
            {gameMenuOpen && (
              <div className="game-menu" id="game-menu" role="menu" aria-label="选择游戏"
                onKeyDown={event => {
                  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
                  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
                  buttons[next]?.focus();
                }}>
                <div className="menu-label">游戏环境</div>
                {games.map(item => (
                  <button key={item.id} role="menuitemradio" aria-checked={item.id === game} className={'game-option ' + (item.id === game ? 'selected' : '')}
                    onClick={() => {
                      setGame(item.id); setGameMenuOpen(false); gameButton.current?.focus();
                      if (item.id !== game) addLog('已切换查看：' + item.label + '。');
                    }}>
                    <span className="game-mark" style={{ background: item.color }} />
                    <span><strong>{item.label}</strong><small>{item.generation} · {item.detail}</small></span>
                    {item.id === game && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <GlobalTools connections={actualConnections} unread={unread} open={openModal} />
        </div>

        <nav className="sidebar-nav" aria-label="工作区">
          <NavItem label="首页" icon={<Home size={16} />} active={page === '首页'} onClick={() => setPage('首页')} />
          <NavItem label="脚本编辑" icon={<TerminalSquare size={16} />} active={page === '脚本编辑'} onClick={() => setPage('脚本编辑')} />
        </nav>
        <footer className="sidebar-footer">
          <span className="brand-mark" aria-hidden="true" />
          <div className="sidebar-brand"><span>Auto Poke RNG</span><small>界面预览 · {version}</small></div>
          <button ref={settingsButton} className={'icon-button sidebar-settings ' + (modal === 'settings' ? 'active' : '')}
            type="button" title="设置" aria-label="设置" aria-haspopup="dialog" aria-expanded={modal === 'settings'}
            onClick={() => openModal('settings')}><Settings size={16} /></button>
        </footer>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <IconButton label={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => setCollapsed(value => !value)}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </IconButton>
          <h1>{page}</h1>
          <div className="topbar-actions">
            <button className="search-trigger" title="快速查找 (Ctrl+K)" aria-label="快速查找" onClick={() => setPaletteOpen(true)}><Search size={15} /><kbd>Ctrl K</kbd></button>
            <span className="run-state"><span className={'status-dot ' + (run || recording ? 'success' : '')} />{run ? run.folder + (window.desktop?.devices ? ' · 运行中' : ' · 演示运行中') : recording ? '录制预览中' : '待命'}</span>
          </div>
        </header>

        <div className="workspace-content">
          {page === '脚本编辑' && <ScriptWorkspace scriptId={library.active?.path || ''} scriptName={library.active?.name || ''} script={script}
            onChange={body => library.update({ body })} onRename={name => library.update({ name })} onCursorChange={setCursor} saved={saved}
            busy={library.busy} statusLabel={!library.active ? '' : library.active.missing ? '文件已移除 · 编辑保留' : library.active.diskChanged ? '外部已修改 · 编辑保留' : saved ? '已保存' : '未保存'} onSave={saveDraft}
            library={<ScriptLibrary {...library} selectedPath={library.active?.path} />}
            logs={logs} clearLogs={() => setLogs([])} running={Boolean(run)} runningName={run?.scriptName} recording={recording} elapsed={elapsed} toggleRunning={toggleRunning} toggleRecording={toggleRecording} openModal={openModal}
            virtualControllerOpen={virtualControllerOpen} toggleVirtualController={() => void toggleVirtualController()} />}
          {page === '首页' && <div className="empty-state home-empty"><Home size={28} /><h2>开始你的工作</h2><p>当前游戏为{activeGame.label}，打开脚本编辑开始配置操作。</p><button className="button" onClick={() => setPage('脚本编辑')}><TerminalSquare size={15} />打开脚本编辑</button></div>}
        </div>
        <footer className="workspace-footer" aria-label="工作区状态与工具">
          <div className="workspace-status">
            {page === '脚本编辑' ? <>
              <span>文本脚本</span>
              <span className="workspace-cursor">行 {cursor.line}，列 {cursor.column}</span>
              <span>UTF-8</span>
              <span>{script.split('\n').length} 行</span>
            </> : <span>{activeGame.label}</span>}
          </div>
          <QuickTools panel={toolPanel} detached={panelWindows.detached} toggle={togglePanel} buttons={dockButtons.current} />
        </footer>
      </main>

      {toolPanel && <FloatingSidePanel state={toolPanel} title={toolPanel.tool === 'video' ? '视频预览' : '日志中心'} icon={toolPanel.tool === 'video' ? <MonitorPlay size={16} /> : <FileClock size={16} />}
        detach={nativePanels ? detachPanel : undefined} detaching={detaching}
        wide={toolPanel.tool === 'video' && panelWindows.videoLabelsOpen}
        actions={toolPanel.tool === 'video' && <VideoLabelsButton expanded={panelWindows.videoLabelsOpen} toggle={() => setVideoLabelsOpen(!panelWindows.videoLabelsOpen)} />}
        minimize={minimizePanel} restore={() => showPanel(toolPanel.tool)} toggleExpanded={() => setToolPanel(current => current && { ...current, expanded: !current.expanded })} close={closePanel}>
        {toolPanel.tool === 'video' ? <VideoPreview labelsOpen={panelWindows.videoLabelsOpen} /> : <LogsPanel logs={logs} source={panelWindows.logSource} setSource={setLogSource} clear={() => setLogs([])} />}
      </FloatingSidePanel>}
      {modal === 'mapping' && <KeyMappingDialog close={closeModal} onSaved={async mapping => { await overlayApi?.setMapping(mapping); }} />}
      {modal && modal !== 'mapping' && <ToolsDialog modal={modal} close={closeModal} onInput={key => { if (recording) addLog('输入预览：' + key, '手柄'); }} />}
      {!overlayApi && virtualControllerOpen && <VirtualControllerWindow close={() => setVirtualControllerOpen(false)} onInput={key => { if (recording) addLog('输入预览：' + key, '手柄'); }} />}
      {paletteOpen && <CommandPalette actions={actions} close={() => setPaletteOpen(false)} />}
      {(toast || panelError) && <div className="toast" role="status"><Check size={15} />{toast || panelError}</div>}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button className="icon-button" type="button" title={label} aria-label={label} onClick={onClick}>{children}</button>;
}

function NavItem({ label, icon, active, onClick }: { label: string; icon: ReactNode; active: boolean; onClick: () => void }) {
  return <button className={'nav-item ' + (active ? 'active' : '')} title={label} aria-current={active ? 'page' : undefined} onClick={onClick}>{icon}<span>{label}</span></button>;
}
