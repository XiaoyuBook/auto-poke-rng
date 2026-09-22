import { useEffect, useMemo, useState } from 'react';
import {
  Activity, Bell, Braces, Check, ChevronDown, ChevronRight, CircleHelp, Command,
  FileClock, FileCode2, Gamepad2, Home, Keyboard, ListFilter, MoreHorizontal,
  PanelLeftClose, Play, Plus, Radio, Search, Settings2, Square, TerminalSquare,
  Video, X,
} from 'lucide-react';

type Page = '首页' | '脚本编辑' | '视频预览' | '日志中心';
type Game = '火叶' | '珍钻复刻' | '剑盾';
type Modal = 'controller' | 'video' | 'mapping' | 'help' | null;
type LogEntry = { time: string; source: string; message: string; level?: 'info' | 'success' | 'warning' };

const games: { label: Game; generation: string; detail: string; color: string }[] = [
  { label: '火叶', generation: '第三世代', detail: 'FRLG · Switch', color: '#ec7c88' },
  { label: '珍钻复刻', generation: '第八世代', detail: 'BDSP · Switch', color: '#78a8ef' },
  { label: '剑盾', generation: '第八世代', detail: 'SWSH · 规划中', color: '#a9a1ef' },
];

const initialLogs: LogEntry[] = [
  { time: '10:42:18', source: '系统', message: '工作区已就绪，等待脚本运行。' },
  { time: '10:41:56', source: '视频源', message: '尚未连接采集设备。', level: 'warning' },
  { time: '10:41:32', source: '脚本', message: '已加载：火叶 · 定点捕获流程。' },
];

const defaultScript = [
  '# 火叶 · 定点捕获流程', '# 当前档案：FRLG / 日文 / Switch', '',
  'connect video "Elgato HD60 S+"', 'wait 500', 'press HOME', 'wait 300', '',
  '# 启动目标流程', 'run encounter --target shiny', 'wait-until frame 18432',
  'confirm result', 'save record',
].join('\n');

const pageMeta: Record<Page, { title: string; description: string }> = {
  首页: { title: '工作台总览', description: '查看当前游戏、运行状态和最近工作。' },
  脚本编辑: { title: '脚本编辑', description: '编辑操作脚本，检查运行日志，并通过虚拟手柄验证输入。' },
  视频预览: { title: '视频预览', description: '查看当前设备画面，并核对脚本执行过程。' },
  日志中心: { title: '日志中心', description: '汇总当前应用的运行、连接和操作记录。' },
};

function App() {
  const [page, setPage] = useState<Page>('脚本编辑');
  const [game, setGame] = useState<Game>('火叶');
  const [gameMenuOpen, setGameMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [running, setRunning] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [script, setScript] = useState(defaultScript);
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);
  const [modal, setModal] = useState<Modal>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [metadata, setMetadata] = useState('v0.1.0');

  const activeGame = games.find((item) => item.label === game)!;
  const currentMeta = pageMeta[page];
  const lines = useMemo(() => Math.max(1, script.split('\n').length), [script]);

  useEffect(() => {
    window.desktop?.getMetadata().then((data) => setMetadata(`v${data.version}`)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setPaletteOpen((value) => !value);
      }
      if (event.key === 'Escape') { setPaletteOpen(false); setModal(null); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const addLog = (message: string, level: LogEntry['level'] = 'info', source = '系统') => {
    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs((entries) => [{ time: now, source, message, level }, ...entries]);
  };

  const toggleRunning = () => {
    const next = !running; setRunning(next);
    if (next) { setElapsed(0); addLog('脚本已开始运行。', 'success', '脚本'); }
    else addLog('脚本已停止运行。', 'warning', '脚本');
  };

  const toggleRecording = () => {
    const next = !recording; setRecording(next);
    addLog(next ? '开始录制手柄输入。' : '脚本录制已停止。', next ? 'success' : 'info', '手柄');
  };

  const selectPage = (next: Page) => { setPage(next); setPaletteOpen(false); };

  return <div className="app-shell" data-collapsed={collapsed}>
    <div className="titlebar"><div className="brand-mark">R</div><span className="brand-name">AUTO POKE RNG</span><span className="brand-version">{metadata}</span><div className="titlebar-spacer" /><span className="titlebar-hint">Desktop workspace</span></div>
    <div className="app-body">
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="workspace-switcher">
            <button className="workspace-button" onClick={() => setGameMenuOpen((value) => !value)} aria-expanded={gameMenuOpen}>
              <span className="game-dot" style={{ background: activeGame.color }} /><span className="workspace-button-text"><strong>{game}</strong><small>{activeGame.detail}</small></span><ChevronDown size={14} />
            </button>
            {gameMenuOpen && <div className="game-menu"><div className="menu-label">选择游戏环境</div>{games.map((item) => <button key={item.label} className={`game-option ${item.label === game ? 'selected' : ''}`} onClick={() => { setGame(item.label); setGameMenuOpen(false); addLog(`已切换当前版本：${item.label}。`); }}><span className="game-dot" style={{ background: item.color }} /><span><strong>{item.label}</strong><small>{item.generation} · {item.detail}</small></span>{item.label === game && <Check size={14} />}</button>)}<div className="menu-foot"><Plus size={13} /> 添加游戏环境</div></div>}
          </div>
          <div className="sidebar-actions"><button className="icon-button" title="搜索" onClick={() => setPaletteOpen(true)}><Search size={15} /></button><button className="icon-button" title="通知"><Bell size={15} /><span className="notification-dot" /></button></div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section-label">工作区</div>
          <NavItem icon={<Home size={15} />} label="首页" active={page === '首页'} onClick={() => selectPage('首页')} />
          <NavItem icon={<TerminalSquare size={15} />} label="脚本编辑" active={page === '脚本编辑'} onClick={() => selectPage('脚本编辑')} />
          <NavItem icon={<Video size={15} />} label="视频预览" active={page === '视频预览'} onClick={() => selectPage('视频预览')} trailing={<span className="nav-status warning" />} />
          <NavItem icon={<FileClock size={15} />} label="日志中心" active={page === '日志中心'} onClick={() => selectPage('日志中心')} />
          <div className="nav-section-label nav-section-spaced">工具</div>
          <NavItem icon={<Gamepad2 size={15} />} label="虚拟手柄" onClick={() => setModal('controller')} />
          <NavItem icon={<Keyboard size={15} />} label="按键映射" onClick={() => setModal('mapping')} />
          <NavItem icon={<Settings2 size={15} />} label="设置" onClick={() => addLog('设置面板将在连接设备后开放。')} />
        </nav>
        <div className="sidebar-bottom"><div className="connection-row"><span className="connection-dot offline" />视频源未连接</div><div className="sidebar-footer-row"><span>工作区原型</span><button className="collapse-button" onClick={() => setCollapsed((value) => !value)} title={collapsed ? '展开侧栏' : '收缩侧栏'}><PanelLeftClose size={15} /></button></div></div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="breadcrumbs"><span>工作台</span><ChevronRight size={14} /><strong>{currentMeta.title}</strong></div><div className="topbar-actions"><button className="command-trigger" onClick={() => setPaletteOpen(true)}><Search size={14} /><span>快速查找</span><kbd><Command size={11} /> K</kbd></button><div className="topbar-divider" /><button className="topbar-icon" title="帮助" onClick={() => setModal('help')}><CircleHelp size={16} /></button><div className="run-state"><span className={`state-dot ${running ? 'active' : ''}`} />{running ? '运行中' : '待命'}</div></div></header>
        <div className="content-scroll">
          <div className="page-heading"><div><div className="eyebrow">{game} / {activeGame.detail}</div><h1>{currentMeta.title}</h1><p>{currentMeta.description}</p></div><div className="heading-actions">{page === '脚本编辑' && <button className={`primary-button ${running ? 'danger' : ''}`} onClick={toggleRunning}>{running ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}{running ? '停止运行' : '开始运行'}</button>}<button className="more-button" title="更多操作"><MoreHorizontal size={17} /></button></div></div>
          {page === '脚本编辑' && <ScriptWorkspace script={script} setScript={setScript} lines={lines} logs={logs} elapsed={elapsed} running={running} recording={recording} toggleRunning={toggleRunning} toggleRecording={toggleRecording} setModal={setModal} addLog={addLog} />}
          {page === '首页' && <OverviewPage game={game} activeGame={activeGame} running={running} logs={logs} selectPage={selectPage} />}
          {page === '视频预览' && <VideoPage activeGame={activeGame} openVideo={() => setModal('video')} />}
          {page === '日志中心' && <LogsPage logs={logs} clear={() => setLogs([])} />}
        </div>
      </main>
    </div>
    {modal && <ModalLayer modal={modal} close={() => setModal(null)} />}
    {paletteOpen && <CommandPalette close={() => setPaletteOpen(false)} selectPage={selectPage} openModal={setModal} />}
  </div>;
}

function NavItem({ icon, label, active, onClick, trailing }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; trailing?: React.ReactNode }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><span className="nav-icon">{icon}</span><span className="nav-label">{label}</span>{trailing}</button>;
}

function ScriptWorkspace({ script, setScript, lines, logs, elapsed, running, recording, toggleRunning, toggleRecording, setModal, addLog }: { script: string; setScript: (value: string) => void; lines: number; logs: LogEntry[]; elapsed: number; running: boolean; recording: boolean; toggleRunning: () => void; toggleRecording: () => void; setModal: (modal: Modal) => void; addLog: (message: string, level?: LogEntry['level'], source?: string) => void }) {
  const formatTime = (value: number) => `${String(Math.floor(value / 3600)).padStart(2, '0')}:${String(Math.floor((value % 3600) / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  return <section className="script-workspace"><div className="console-column"><Panel title="运行日志" action={<button className="text-button" onClick={() => addLog('日志已清空。')}>清空</button>} extraClass="log-panel"><div className="log-stream">{logs.slice(0, 8).map((log, index) => <div className="log-line" key={`${log.time}-${index}`}><span className="log-time">{log.time}</span><span className={`log-level ${log.level || ''}`} /><span className="log-message">{log.message}</span></div>)}</div></Panel><Panel title="运行控制"><div className="run-card"><div className="run-card-label"><Activity size={14} />执行时长</div><strong>{formatTime(elapsed)}</strong></div><button className={`wide-button ${running ? 'danger-outline' : ''}`} onClick={toggleRunning}>{running ? <><Square size={14} fill="currentColor" />停止运行</> : <><Play size={14} fill="currentColor" />开始运行</>}</button></Panel><Panel title="工具"><div className="tool-grid"><ToolButton icon={<Radio size={15} />} label={recording ? '停止录制' : '开始录制'} hint="记录手柄输入" active={recording} onClick={toggleRecording} /><ToolButton icon={<Gamepad2 size={15} />} label="虚拟手柄" hint="打开输入面板" onClick={() => setModal('controller')} /><ToolButton icon={<Keyboard size={15} />} label="按键映射" hint="配置输入关系" onClick={() => setModal('mapping')} /><ToolButton icon={<CircleHelp size={15} />} label="查看帮助" hint="脚本语法说明" onClick={() => setModal('help')} /></div></Panel></div><div className="editor-column"><div className="editor-toolbar"><div className="editor-file"><FileCode2 size={15} /><span>frlg-static-encounter.rng</span><span className="file-dot" /></div><div className="editor-actions"><span className="saved-state">未保存</span><button className="editor-icon"><Braces size={15} /></button><button className="editor-icon"><MoreHorizontal size={16} /></button></div></div><div className="editor-surface"><pre className="line-numbers">{Array.from({ length: lines }, (_, index) => index + 1).join('\n')}</pre><textarea value={script} onChange={(event) => setScript(event.target.value)} spellCheck={false} aria-label="脚本内容" /></div><div className="editor-statusbar"><span><span className="status-green" />脚本语法正常</span><span>UTF-8</span><span>LF</span><span>行 {lines}, 列 1</span></div></div></section>;
}

function Panel({ title, action, children, extraClass = '' }: { title: string; action?: React.ReactNode; children: React.ReactNode; extraClass?: string }) {
  return <div className={`panel ${extraClass}`}><div className="panel-heading"><span>{title}</span>{action}</div>{children}</div>;
}

function ToolButton({ icon, label, hint, active, onClick }: { icon: React.ReactNode; label: string; hint: string; active?: boolean; onClick: () => void }) {
  return <button className={`tool-button ${active ? 'active' : ''}`} onClick={onClick}><span className="tool-icon">{icon}</span><span><strong>{label}</strong><small>{hint}</small></span></button>;
}

function OverviewPage({ game, activeGame, running, logs, selectPage }: { game: Game; activeGame: (typeof games)[number]; running: boolean; logs: LogEntry[]; selectPage: (page: Page) => void }) {
  return <div className="overview-page"><div className="overview-grid"><div className="overview-card large"><div className="card-top"><span className="card-kicker">当前任务</span><span className="status-pill"><span className={`state-dot ${running ? 'active' : ''}`} />{running ? '运行中' : '待命'}</span></div><div className="task-title"><span className="game-avatar" style={{ background: activeGame.color }}>{game.slice(0, 1)}</span><div><h2>定点捕获流程</h2><p>{game} · Switch · 默认参数档案</p></div></div><div className="task-metrics"><div><span>目标帧</span><strong>18,432</strong></div><div><span>当前帧</span><strong>12,820</strong></div><div><span>完成度</span><strong>69.5%</strong></div></div><div className="progress-track"><span style={{ width: '69.5%' }} /></div><button className="card-link" onClick={() => selectPage('脚本编辑')}>打开工作区 <ChevronRight size={14} /></button></div><div className="overview-card"><div className="card-top"><span className="card-kicker">视频源</span><Video size={16} className="card-icon" /></div><div className="empty-video"><span className="video-icon"><Video size={18} /></span><strong>等待连接</strong><small>选择一个视频设备开始预览</small></div><button className="card-link" onClick={() => selectPage('视频预览')}>打开视频预览 <ChevronRight size={14} /></button></div><div className="overview-card"><div className="card-top"><span className="card-kicker">最近记录</span><FileClock size={16} className="card-icon" /></div><div className="mini-list">{logs.slice(0, 3).map((log) => <div className="mini-row" key={log.time}><span className="mini-time">{log.time}</span><span>{log.message}</span></div>)}</div><button className="card-link" onClick={() => selectPage('日志中心')}>查看全部日志 <ChevronRight size={14} /></button></div></div></div>;
}

function VideoPage({ activeGame, openVideo }: { activeGame: (typeof games)[number]; openVideo: () => void }) {
  return <section className="video-page"><div className="video-stage"><div className="video-stage-top"><span><span className="offline-dot" />未连接</span><span>{activeGame.detail}</span></div><div className="video-empty"><Video size={26} /><strong>视频源未连接</strong><p>连接采集设备后，实时画面和识别区域会显示在这里。</p><button className="primary-button" onClick={openVideo}>选择视频源</button></div><div className="video-stage-bottom"><span>预览窗口</span><span>识别叠层关闭</span><button className="text-button" onClick={openVideo}>设置</button></div></div><aside className="video-side-panel"><div className="side-panel-title">识别配置</div><div className="setting-row"><span>识别区域</span><strong>未配置</strong></div><div className="setting-row"><span>模板</span><strong>FRLG 默认</strong></div><div className="setting-row"><span>帧率</span><strong>—</strong></div><div className="side-note"><CircleHelp size={14} />切换游戏或任务时会加载对应的识别区域。</div></aside></section>;
}

function LogsPage({ logs, clear }: { logs: LogEntry[]; clear: () => void }) {
  return <section className="logs-page"><div className="logs-toolbar"><div className="log-filter"><ListFilter size={14} />全部来源<ChevronDown size={13} /></div><button className="text-button" onClick={clear}>清空日志</button></div><div className="logs-table"><div className="logs-table-head"><span>时间</span><span>来源</span><span>内容</span><span>状态</span></div>{logs.map((log, index) => <div className="logs-table-row" key={`${log.time}-${index}`}><span className="mono">{log.time}</span><span className="muted-cell">{log.source}</span><span>{log.message}</span><span>{log.level === 'warning' ? <span className="table-status warning">注意</span> : <span className="table-status">记录</span>}</span></div>)}</div></section>;
}

function ModalLayer({ modal, close }: { modal: Exclude<Modal, null>; close: () => void }) {
  const content = {
    controller: { title: '虚拟手柄', body: <div className="controller-preview"><div className="dpad"><span /><span /><span /><span /><span /></div><div className="controller-center">输入预览</div><div className="face-buttons"><b>Y</b><b>X</b><b>B</b><b>A</b></div></div> },
    video: { title: '视频源', body: <div className="modal-copy"><p>选择当前脚本和视频预览使用的设备画面。</p><div className="device-option"><span className="offline-dot" /><span><strong>尚未连接视频源</strong><small>可用设备将在这里显示</small></span><ChevronRight size={15} /></div></div> },
    mapping: { title: '按键映射', body: <div className="mapping-list">{[['确认', 'A'], ['取消', 'B'], ['菜单', '＋'], ['方向', '方向键']].map(([name, key]) => <div key={name}><span>{name}</span><kbd>{key}</kbd></div>)}</div> },
    help: { title: '脚本编辑帮助', body: <div className="modal-copy"><p>每行代表一个操作，空行和以 <code>#</code> 开始的内容会被忽略。</p><p><code>wait 1000</code><small>等待 1000 毫秒</small></p><p><code>press A</code><small>按下 A 键</small></p><p><code>run encounter --target shiny</code><small>执行目标流程</small></p></div> },
  }[modal];
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><div className="modal"><div className="modal-header"><h2>{content.title}</h2><button className="modal-close" onClick={close}><X size={16} /></button></div><div className="modal-body">{content.body}</div></div></div>;
}

function CommandPalette({ close, selectPage, openModal }: { close: () => void; selectPage: (page: Page) => void; openModal: (modal: Modal) => void }) {
  const actions: { label: string; hint: string; icon: React.ReactNode; action: () => void }[] = [
    { label: '打开脚本编辑', hint: '工作区', icon: <TerminalSquare size={15} />, action: () => selectPage('脚本编辑') },
    { label: '打开视频预览', hint: '工作区', icon: <Video size={15} />, action: () => selectPage('视频预览') },
    { label: '打开日志中心', hint: '工作区', icon: <FileClock size={15} />, action: () => selectPage('日志中心') },
    { label: '打开虚拟手柄', hint: '工具', icon: <Gamepad2 size={15} />, action: () => openModal('controller') },
  ];
  return <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><div className="command-palette"><div className="palette-search"><Search size={16} /><input autoFocus placeholder="搜索页面、工具或动作…" /><kbd>ESC</kbd></div><div className="palette-section-label">快捷动作</div>{actions.map((item) => <button className="palette-action" key={item.label} onClick={() => { item.action(); close(); }}><span className="palette-icon">{item.icon}</span><span>{item.label}</span><small>{item.hint}</small><ChevronRight size={14} /></button>)}<div className="palette-footer"><span><Command size={12} /> K</span><span>打开命令面板</span></div></div></div>;
}

export default App;
