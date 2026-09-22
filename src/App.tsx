import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bell, Check, ChevronDown, CircleHelp, FileClock, Gamepad2, Home, Keyboard,
  MonitorPlay, PanelLeftClose, PanelLeftOpen, Search, TerminalSquare, Tv,
} from 'lucide-react';
import { CommandPalette, type CommandAction } from './components/CommandPalette';
import { LogsPanel } from './components/LogsPanel';
import { FloatingSidePanel, type PanelState, type PanelTool } from './components/FloatingSidePanel';
import { ScriptWorkspace } from './components/ScriptWorkspace';
import { ToolsDialog, VideoPreview } from './components/Tools';
import { createLog, games, readDrafts, type GameId, type LogEntry, type Modal, type Page } from './workspace';

export default function App() {
  const [page, setPage] = useState<Page>('脚本编辑');
  const [game, setGame] = useState<GameId>('frlg');
  const [gameMenuOpen, setGameMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [run, setRun] = useState<{ game: GameId; started: number } | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [initialDrafts] = useState(readDrafts);
  const [savedDrafts, setSavedDrafts] = useState(initialDrafts.drafts);
  const [drafts, setDrafts] = useState(savedDrafts);
  const [logs, setLogs] = useState<LogEntry[]>(() => [createLog('工作区已就绪，等待运行脚本。')]);
  const [modal, setModal] = useState<Modal | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toolPanel, setToolPanel] = useState<PanelState | null>(null);
  const [unread, setUnread] = useState(true);
  const [version, setVersion] = useState('0.1.0');
  const [toast, setToast] = useState('');
  const switcher = useRef<HTMLDivElement>(null);
  const gameButton = useRef<HTMLButtonElement>(null);
  const dockButtons = useRef<Partial<Record<PanelTool, HTMLButtonElement | null>>>({});
  const activeGame = games.find(item => item.id === game)!;
  const script = drafts[game];
  const [savedGames, setSavedGames] = useState(initialDrafts.saved);
  const saved = savedGames.has(game) && script === savedDrafts[game];

  const addLog = useCallback((message: string, source: LogEntry['source'] = '系统', level: LogEntry['level'] = 'info') => {
    setLogs(entries => [...entries, createLog(message, source, level)].slice(-500));
  }, []);

  const openModal = (next: Modal) => {
    setGameMenuOpen(false);
    if (next === 'notification') setUnread(false);
    setModal(next);
  };

  const showPanel = (tool: PanelTool) => {
    setToolPanel(current => ({ tool, minimized: false, expanded: current?.expanded ?? false }));
  };

  const togglePanel = (tool: PanelTool) => {
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

  const saveDraft = useCallback(() => {
    try {
      const next = { ...savedDrafts, [game]: script };
      const ids = new Set(savedGames).add(game);
      localStorage.setItem('auto-poke-rng:drafts', JSON.stringify(Object.fromEntries([...ids].map(id => [id, next[id]]))));
      setSavedDrafts(next);
      setSavedGames(previous => new Set(previous).add(game));
      setToast('草稿已保存到本机');
    } catch {
      setToast('保存失败，请检查本机存储空间');
      addLog('草稿保存失败，编辑内容仍保留在当前窗口。', '脚本', 'warning');
    }
  }, [addLog, game, savedDrafts, savedGames, script]);

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
    if (run) {
      setElapsed(Math.floor((Date.now() - run.started) / 1000));
      setRun(null);
      addLog('运行演示已停止。', '脚本');
    } else {
      setElapsed(0);
      setRun({ game, started: Date.now() });
      addLog(activeGame.label + '：开始运行演示，不向设备发送操作。', '脚本', 'success');
    }
  };

  const toggleRecording = () => {
    setRecording(value => !value);
    addLog(recording ? '已停止输入录制预览。' : '开始输入录制预览，可在虚拟手柄中点击按键。', '手柄');
  };

  const actions: CommandAction[] = [
    { label: '首页', keywords: 'home', icon: <Home size={16} />, run: () => setPage('首页') },
    { label: '脚本编辑', keywords: 'script editor', icon: <TerminalSquare size={16} />, run: () => setPage('脚本编辑') },
    { label: '视频预览', keywords: 'video preview', icon: <MonitorPlay size={16} />, run: () => showPanel('video') },
    { label: '日志中心', keywords: 'logs history', icon: <FileClock size={16} />, run: () => showPanel('logs') },
    { label: '视频源', keywords: 'tv source', icon: <Tv size={16} />, run: () => openModal('video') },
    { label: '虚拟手柄', keywords: 'controller gamepad', icon: <Gamepad2 size={16} />, run: () => openModal('controller') },
    { label: '按键映射', keywords: 'keyboard mapping', icon: <Keyboard size={16} />, run: () => openModal('mapping') },
    { label: '脚本编辑帮助', keywords: 'help', icon: <CircleHelp size={16} />, run: () => openModal('help') },
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
          <div className="sidebar-actions" role="group" aria-label="全局工具">
            <IconButton label="视频源：未连接" onClick={() => openModal('video')}><Tv size={16} /><span className="tool-status-dot offline" /></IconButton>
            <IconButton label="虚拟手柄：输入预览" onClick={() => openModal('controller')}><Gamepad2 size={16} /><span className="tool-status-dot available" /></IconButton>
            <IconButton label={unread ? '通知：有未读通知' : '通知'} onClick={() => openModal('notification')}><Bell size={16} />{unread && <span className="tool-status-dot information" />}</IconButton>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="工作区">
          <NavItem label="首页" icon={<Home size={16} />} active={page === '首页'} onClick={() => setPage('首页')} />
          <NavItem label="脚本编辑" icon={<TerminalSquare size={16} />} active={page === '脚本编辑'} onClick={() => setPage('脚本编辑')} />
        </nav>
        <footer className="sidebar-footer">
          <span className="brand-mark" aria-hidden="true" />
          <div><span>Auto Poke RNG</span><small>界面预览 · {version}</small></div>
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
            <span className="run-state"><span className={'status-dot ' + (run || recording ? 'success' : '')} />{run ? games.find(item => item.id === run.game)!.label + ' · 演示运行中' : recording ? '录制预览中' : '待命'}</span>
          </div>
        </header>

        <div className="workspace-content">
          {page === '脚本编辑' && <ScriptWorkspace key={game} script={script} onChange={value => setDrafts(current => ({ ...current, [game]: value }))} saved={saved} onSave={saveDraft}
            logs={logs} clearLogs={() => setLogs([])} running={Boolean(run)} recording={recording} elapsed={elapsed} toggleRunning={toggleRunning} toggleRecording={toggleRecording} openModal={openModal} />}
          {page === '首页' && <div className="empty-state home-empty"><Home size={28} /><h2>开始你的工作</h2><p>当前游戏为{activeGame.label}，打开脚本编辑开始配置操作。</p><button className="button" onClick={() => setPage('脚本编辑')}><TerminalSquare size={15} />打开脚本编辑</button></div>}
        </div>
      </main>

      <div className="quick-dock" role="toolbar" aria-label="快捷工具">
        <button ref={node => { dockButtons.current.video = node; }} className={'icon-button ' + (toolPanel?.tool === 'video' && !toolPanel.minimized ? 'active' : '')}
          title="视频预览" aria-label="视频预览" aria-expanded={toolPanel?.tool === 'video' && !toolPanel.minimized} aria-controls={toolPanel?.tool === 'video' ? 'floating-tool-panel' : undefined} aria-haspopup="dialog" onClick={() => togglePanel('video')}><MonitorPlay size={18} /></button>
        <button ref={node => { dockButtons.current.logs = node; }} className={'icon-button ' + (toolPanel?.tool === 'logs' && !toolPanel.minimized ? 'active' : '')}
          title="日志中心" aria-label="日志中心" aria-expanded={toolPanel?.tool === 'logs' && !toolPanel.minimized} aria-controls={toolPanel?.tool === 'logs' ? 'floating-tool-panel' : undefined} aria-haspopup="dialog" onClick={() => togglePanel('logs')}><FileClock size={18} /></button>
      </div>
      {toolPanel && <FloatingSidePanel state={toolPanel} title={toolPanel.tool === 'video' ? '视频预览' : '日志中心'} icon={toolPanel.tool === 'video' ? <MonitorPlay size={16} /> : <FileClock size={16} />}
        minimize={minimizePanel} restore={() => showPanel(toolPanel.tool)} toggleExpanded={() => setToolPanel(current => current && { ...current, expanded: !current.expanded })} close={closePanel}>
        {toolPanel.tool === 'video' ? <VideoPreview openSource={() => openModal('video')} /> : <LogsPanel logs={logs} clear={() => setLogs([])} />}
      </FloatingSidePanel>}
      {modal && <ToolsDialog modal={modal} close={() => setModal(null)} onInput={key => { if (recording) addLog('输入预览：' + key, '手柄'); }} />}
      {paletteOpen && <CommandPalette actions={actions} close={() => setPaletteOpen(false)} />}
      {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button className="icon-button" type="button" title={label} aria-label={label} onClick={onClick}>{children}</button>;
}

function NavItem({ label, icon, active, onClick }: { label: string; icon: ReactNode; active: boolean; onClick: () => void }) {
  return <button className={'nav-item ' + (active ? 'active' : '')} title={label} aria-current={active ? 'page' : undefined} onClick={onClick}>{icon}<span>{label}</span></button>;
}
