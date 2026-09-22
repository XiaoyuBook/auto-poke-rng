import { useEffect, useRef, type ReactNode } from 'react';
import { CircleHelp, Circle, FileCode2, Gamepad2, Keyboard, Play, Save, Square, TerminalSquare } from 'lucide-react';
import { formatElapsed, type LogEntry, type Modal } from '../workspace';

interface Props {
  scriptId: string;
  scriptName: string;
  script: string;
  library: ReactNode;
  onChange: (script: string) => void;
  onRename: (name: string) => void;
  onCursorChange: (position: { line: number; column: number }) => void;
  saved: boolean;
  busy: boolean;
  statusLabel: string;
  onSave: () => void;
  logs: LogEntry[];
  clearLogs: () => void;
  running: boolean;
  runningName?: string;
  recording: boolean;
  elapsed: number;
  toggleRunning: () => void;
  toggleRecording: () => void;
  openModal: (modal: Modal) => void;
}

export function ScriptWorkspace(props: Props) {
  const lineNumbers = useRef<HTMLPreElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const logStream = useRef<HTMLDivElement>(null);
  const followLogs = useRef(true);
  const { onCursorChange, scriptId } = props;
  const lines = props.script.split('\n').length;
  useEffect(() => {
    editor.current?.setSelectionRange(0, 0);
    if (editor.current) editor.current.scrollTop = 0;
    if (lineNumbers.current) lineNumbers.current.scrollTop = 0;
    onCursorChange({ line: 1, column: 1 });
  }, [onCursorChange, scriptId]);
  useEffect(() => {
    if (logStream.current && followLogs.current) logStream.current.scrollTop = logStream.current.scrollHeight;
  }, [props.logs]);
  const updateCursor = () => {
    const field = editor.current;
    if (!field) return;
    const beforeCursor = field.value.slice(0, field.selectionStart).split('\n');
    onCursorChange({ line: beforeCursor.length, column: beforeCursor.at(-1)!.length + 1 });
  };

  return <section className="script-workspace" aria-label="脚本工作区">
    {props.library}
    <section className="editor-column" aria-label="脚本编辑器">
      <div className="editor-toolbar">
        <div className="editor-file">
          <FileCode2 size={16} />
          {props.scriptId ? <><input className="script-title-input" aria-label="脚本名称" title={'scripts/' + props.scriptId + '（修改名称后保存）'} maxLength={80} value={props.scriptName} onChange={event => props.onRename(event.target.value)} placeholder="未命名脚本" />
          <span className="file-extension">.rng</span></> : <span className="file-extension">未打开脚本</span>}
        </div>
        <div className="editor-actions">
          <span className="saved-state">{props.statusLabel}</span>
          <button className="icon-button" title="保存文件 (Ctrl+S)" aria-label="保存脚本" onClick={props.onSave} disabled={props.saved || props.busy || !props.scriptId}><Save size={15} /></button>
          <span className="toolbar-separator" />
          <button className={'button run-button ' + (props.running ? 'danger' : 'primary')} onClick={props.toggleRunning} disabled={props.recording || (!props.running && !props.script.trim())} title={window.desktop?.devices ? '通过伊机控执行当前编辑内容' : '运行界面演示，不向设备发送操作'}>
            {props.running ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
            {props.running ? '停止运行' : '开始运行'}
          </button>
        </div>
      </div>
      <div className="script-tools" role="toolbar" aria-label="脚本工具">
        <button className={'editor-tool-button ' + (props.recording ? 'active' : '')} disabled={props.running || (!props.recording && !props.scriptId)} aria-pressed={props.recording} onClick={props.toggleRecording}>
          {props.recording ? <Square size={13} /> : <Circle size={13} />}<span>{props.recording ? '停止录制' : '开始录制'}</span>
        </button>
        <span className="toolbar-separator" />
        <button className="editor-tool-button" onClick={() => props.openModal('controller')}><Gamepad2 size={14} /><span>虚拟手柄</span></button>
        <button className="editor-tool-button" onClick={() => props.openModal('mapping')}><Keyboard size={14} /><span>按键映射</span></button>
        <button className="editor-tool-button script-help" onClick={() => props.openModal('help')}><CircleHelp size={14} /><span>帮助</span></button>
      </div>
      {props.scriptId ? <div className="editor-surface">
        <pre ref={lineNumbers} className="line-numbers" aria-hidden="true">{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</pre>
        <textarea ref={editor} aria-label="脚本内容" value={props.script} wrap="off" spellCheck={false} autoCapitalize="off"
          onChange={event => { props.onChange(event.target.value); updateCursor(); }} onSelect={updateCursor}
          onScroll={event => { if (lineNumbers.current) lineNumbers.current.scrollTop = event.currentTarget.scrollTop; }} placeholder="# 在此输入脚本" />
      </div> : <div className="empty-state editor-empty"><FileCode2 size={26} /><h2>选择一个脚本</h2><p>展开左侧文件夹，选择脚本开始编辑</p></div>}
      <section className="execution-console" aria-label="运行日志">
        <header className="execution-header">
          <TerminalSquare size={14} /><h2>日志</h2>
          <span className="execution-context" title={props.runningName}>{props.running ? '运行中 · ' + props.runningName : props.recording ? '录制预览中' : '等待运行'}</span>
          <output className="execution-timer" aria-label="执行时长">{formatElapsed(props.elapsed)}</output>
          <button className="text-button" disabled={!props.logs.length} onClick={props.clearLogs}>清屏</button>
        </header>
        <div ref={logStream} className="log-stream" role="log" aria-live="polite" aria-relevant="additions" onScroll={event => {
          const node = event.currentTarget;
          followLogs.current = node.scrollHeight - node.clientHeight - node.scrollTop < 32;
        }}>
          {props.logs.length ? props.logs.map(log => <div className="log-entry" key={log.id}>
            <span className="log-time">{log.time}</span><p><span className={'status-dot ' + log.level} />{log.message}</p>
          </div>) : <p className="empty-log">暂无日志，新的运行记录会显示在这里。</p>}
        </div>
      </section>
    </section>
  </section>;
}
