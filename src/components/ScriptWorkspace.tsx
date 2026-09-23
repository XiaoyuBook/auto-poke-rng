import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleHelp, Circle, FileCode2, Gamepad2, Keyboard, Play, Save, Square, TerminalSquare } from 'lucide-react';
import { formatElapsed, type LogEntry, type Modal } from '../workspace';
import type { ScriptProgress } from '../devices';
import type { ScriptValidation } from '../useScriptValidation';

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
  runningLine?: number;
  progress?: ScriptProgress;
  validation: ScriptValidation & { retry: () => void };
  recording: boolean;
  elapsed: number;
  toggleRunning: () => void;
  toggleRecording: () => void;
  openModal: (modal: Modal) => void;
  virtualControllerOpen: boolean;
  toggleVirtualController: () => void;
}

export function ScriptWorkspace(props: Props) {
  const lineNumbers = useRef<HTMLSpanElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const highlightLayer = useRef<HTMLDivElement>(null);
  const logStream = useRef<HTMLDivElement>(null);
  const followLogs = useRef(true);
  const { onCursorChange, scriptId } = props;
  const [follow, setFollow] = useState(true);
  const sourceLines = props.script.split('\n');
  const diagnostic = props.validation.diagnostic;
  const errorLine = diagnostic?.source === props.scriptId ? diagnostic.line : undefined;
  const syncScroll = () => {
    const field = editor.current;
    if (!field) return;
    if (lineNumbers.current) lineNumbers.current.style.transform = `translateY(${-field.scrollTop}px)`;
    if (highlightLayer.current) highlightLayer.current.style.transform = `translateY(${-field.scrollTop}px)`;
  };
  const revealLine = (line: number) => {
    const field = editor.current;
    if (!field) return;
    const top = 12 + (line - 1) * 24;
    if (top < field.scrollTop || top + 24 > field.scrollTop + field.clientHeight) {
      field.scrollTop = Math.max(0, top - field.clientHeight / 2);
      syncScroll();
    }
  };
  useEffect(() => {
    editor.current?.setSelectionRange(0, 0);
    if (editor.current) editor.current.scrollTop = 0;
    if (lineNumbers.current) lineNumbers.current.style.transform = 'translateY(0)';
    if (highlightLayer.current) highlightLayer.current.style.transform = 'translateY(0)';
    onCursorChange({ line: 1, column: 1 });
  }, [onCursorChange, scriptId]);
  useEffect(() => {
    if (logStream.current && followLogs.current) logStream.current.scrollTop = logStream.current.scrollHeight;
  }, [props.logs]);
  useEffect(() => {
    if (follow && props.runningLine) revealLine(props.runningLine);
  }, [follow, props.runningLine, scriptId]);
  useEffect(() => { if (props.running) setFollow(true); }, [props.running]);
  const updateCursor = () => {
    const field = editor.current;
    if (!field) return;
    const beforeCursor = field.value.slice(0, field.selectionStart).split('\n');
    onCursorChange({ line: beforeCursor.length, column: beforeCursor.at(-1)!.length + 1 });
  };
  const locateError = () => {
    if (!errorLine || !editor.current) return;
    const offset = sourceLines.slice(0, errorLine - 1).reduce((total, line) => total + line.length + 1, 0);
    editor.current.focus();
    editor.current.setSelectionRange(offset, offset + (sourceLines[errorLine - 1]?.length || 0));
    revealLine(errorLine); updateCursor();
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
          <button className={'button run-button ' + (props.running ? 'danger' : 'primary')} onClick={props.toggleRunning} disabled={props.recording || (!props.running && (!props.script.trim() || props.validation.state === 'invalid'))} title={props.validation.state === 'invalid' ? '请先修正脚本语法错误' : window.desktop?.devices ? '通过伊机控执行当前编辑内容' : '运行界面演示，不向设备发送操作'}>
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
        <button className={'editor-tool-button ' + (props.virtualControllerOpen ? 'active' : '')} aria-pressed={props.virtualControllerOpen} onClick={props.toggleVirtualController}><Gamepad2 size={14} /><span>虚拟手柄</span></button>
        <button className="editor-tool-button" onClick={() => props.openModal('mapping')}><Keyboard size={14} /><span>按键映射</span></button>
        <button className="editor-tool-button script-help" onClick={() => props.openModal('help')}><CircleHelp size={14} /><span>帮助</span></button>
      </div>
      {props.running && window.desktop?.devices && <section className="execution-preview" aria-label="脚本执行位置">
        <div className="execution-position">
          <span className="status-dot success" />
          <strong>{props.progress ? `${props.progress.source} · 第 ${props.progress.line} 行` : '准备执行…'}</strong>
          <button className="text-button" aria-pressed={follow} disabled={!props.runningLine} onClick={() => setFollow(value => !value)}>{follow ? '跟随执行' : '恢复跟随'}</button>
        </div>
        {props.progress && <>
          <div className="execution-detail"><span>{props.progress.action}</span>
            {props.progress.loops?.map((loop, index) => <span key={index}>{props.progress!.loops!.length > 1 ? `${index + 1} 层循环` : '循环'} · {loop.iteration}{loop.total == null ? '' : ` / ${loop.total}`}</span>)}
          </div>
          <code className="execution-source-line" title="本次运行源码">{props.progress.text}</code>
          {props.progress.caller && <small>调用自 {props.progress.caller.source} · 第 {props.progress.caller.line} 行</small>}
          {!props.runningLine && <small>显示本次运行源码；当前编辑内容与执行位置不同。</small>}
        </>}
      </section>}
      {props.scriptId ? <div className="editor-surface">
        <pre className="line-numbers" aria-hidden="true"><span ref={lineNumbers} className="line-number-list">{sourceLines.map((_, index) => {
          const running = props.runningLine === index + 1;
          return <span key={index} data-line={index + 1} className={(errorLine === index + 1 ? 'has-syntax-error ' : '') + (running ? 'is-running' : '')} title={errorLine === index + 1 ? diagnostic?.message : undefined}>{index + 1}</span>;
        })}</span></pre>
        <div className="editor-code-wrap">
          <div ref={highlightLayer} className="editor-highlight-layer" aria-hidden="true">
            {sourceLines.map((_, index) => <div key={index} data-line={index + 1} className={'editor-line-mark' + (errorLine === index + 1 ? ' has-syntax-error' : '') + (props.runningLine === index + 1 ? ' is-running' : '')} />)}
          </div>
          <textarea ref={editor} aria-label="脚本内容" value={props.script} wrap="off" spellCheck={false} autoCapitalize="off"
          onChange={event => { props.onChange(event.target.value); updateCursor(); }} onSelect={updateCursor}
          onScroll={syncScroll} onWheel={() => setFollow(false)} placeholder="# 在此输入脚本" />
        </div>
      </div> : <div className="empty-state editor-empty"><FileCode2 size={26} /><h2>选择一个脚本</h2><p>展开左侧文件夹，选择脚本开始编辑</p></div>}
      {props.scriptId && <div className={'syntax-status ' + props.validation.state} role="status" aria-label="语法检查">
        {props.validation.state === 'checking' && '正在检查语法…'}
        {props.validation.state === 'valid' && '语法检查通过'}
        {props.validation.state === 'invalid' && <>
          <span>首个错误 · {diagnostic?.source}{diagnostic?.line ? `:${diagnostic.line}:${diagnostic.column || 1}` : ''} · {diagnostic?.message}</span>
          {errorLine && <button className="text-button" onClick={locateError}>定位错误</button>}
        </>}
        {props.validation.state === 'unavailable' && <><span>语法检查不可用 · {props.validation.message}</span><button className="text-button" onClick={props.validation.retry}>重试</button></>}
      </div>}
      <section className="execution-console" aria-label="运行日志">
        <header className="execution-header">
          <TerminalSquare size={14} /><h2>日志</h2>
          <span className="execution-context" title={props.runningName}>{props.running ? '运行中 · ' + props.runningName + (props.runningLine ? ` · 第 ${props.runningLine} 行` : '') : props.recording ? '录制预览中' : '等待运行'}</span>
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
