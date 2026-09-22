import { useEffect, useRef, type ReactNode } from 'react';
import { CircleHelp, Circle, Gamepad2, Keyboard, Play, Save, Square } from 'lucide-react';
import { formatElapsed, type LogEntry, type Modal } from '../workspace';

interface Props {
  script: string;
  onChange: (script: string) => void;
  onCursorChange: (position: { line: number; column: number }) => void;
  saved: boolean;
  onSave: () => void;
  logs: LogEntry[];
  clearLogs: () => void;
  running: boolean;
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
  const { onCursorChange } = props;
  const lines = props.script.split('\n').length;
  useEffect(() => { onCursorChange({ line: 1, column: 1 }); }, [onCursorChange]);
  useEffect(() => {
    if (logStream.current && followLogs.current) logStream.current.scrollTop = logStream.current.scrollHeight;
  }, [props.logs]);
  const updateCursor = () => {
    const field = editor.current;
    if (!field) return;
    const beforeCursor = field.value.slice(0, field.selectionStart).split('\n');
    onCursorChange({ line: beforeCursor.length, column: beforeCursor.at(-1)!.length + 1 });
  };

  return (
    <section className="script-workspace" aria-label="脚本工作区">
      <div className="console-column">
        <section className="console-section log-section" aria-label="运行日志">
          <div className="section-heading">
            <h2>日志</h2>
            <button className="text-button" disabled={!props.logs.length} onClick={props.clearLogs}>清屏</button>
          </div>
          <div ref={logStream} className="log-stream" role="log" aria-live="polite" aria-relevant="additions" onScroll={event => {
            const node = event.currentTarget;
            followLogs.current = node.scrollHeight - node.clientHeight - node.scrollTop < 32;
          }}>
            {props.logs.length ? props.logs.map(log => (
              <div className="log-entry" key={log.id}>
                <span className="log-time">{log.time}</span>
                <p><span className={'status-dot ' + log.level} />{log.message}</p>
              </div>
            )) : <p className="empty-log">暂无日志，新的运行记录会显示在这里。</p>}
          </div>
        </section>

        <section className="console-section" aria-label="运行控制">
          <div className="section-heading"><h2>运行</h2><span className="muted">演示模式</span></div>
          <div className="run-controls">
            <output className="timer" aria-label="执行时长">{formatElapsed(props.elapsed)}</output>
            <button className={'button run-button ' + (props.running ? 'danger' : 'primary')} onClick={props.toggleRunning} disabled={props.recording || (!props.running && !props.script.trim())}>
              {props.running ? <Square size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
              {props.running ? '停止运行' : '开始运行'}
            </button>
          </div>
          <p className="run-hint">预览运行状态，不向设备发送操作。</p>
        </section>

        <section className="console-section tools-section" aria-label="脚本工具">
          <div className="section-heading"><h2>工具</h2></div>
          <div className="tool-grid">
            <ToolButton icon={<Circle size={16} />} label={props.recording ? '停止录制' : '开始录制'} hint="手柄输入预览" active={props.recording} disabled={props.running} onClick={props.toggleRecording} />
            <ToolButton icon={<Gamepad2 size={16} />} label="虚拟手柄" hint="打开输入面板" onClick={() => props.openModal('controller')} />
            <ToolButton icon={<Keyboard size={16} />} label="按键映射" hint="查看对应关系" onClick={() => props.openModal('mapping')} />
            <ToolButton icon={<CircleHelp size={16} />} label="帮助" hint="查看脚本说明" onClick={() => props.openModal('help')} />
          </div>
        </section>
      </div>

      <section className="editor-column" aria-label="脚本编辑器">
        <div className="editor-toolbar">
          <div className="editor-file"><span className="script-glyph">&gt;_</span><span>脚本</span><span className="file-name">untitled.rng</span></div>
          <div className="editor-actions">
            <span className="saved-state">{props.saved ? '已保存到本机' : '未保存'}</span>
            <button className="icon-button" title="保存草稿 (Ctrl+S)" aria-label="保存草稿" onClick={props.onSave} disabled={props.saved}><Save size={15} /></button>
          </div>
        </div>
        <div className="editor-surface">
          <pre ref={lineNumbers} className="line-numbers" aria-hidden="true">{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</pre>
          <textarea
            ref={editor}
            aria-label="脚本内容"
            value={props.script}
            wrap="off"
            spellCheck={false}
            autoCapitalize="off"
            onChange={event => { props.onChange(event.target.value); updateCursor(); }}
            onSelect={updateCursor}
            onScroll={event => { if (lineNumbers.current) lineNumbers.current.scrollTop = event.currentTarget.scrollTop; }}
            placeholder="# 在此输入脚本"
          />
        </div>
      </section>
    </section>
  );
}

function ToolButton({ icon, label, hint, active, disabled, onClick }: {
  icon: ReactNode; label: string; hint: string; active?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button className={'tool-button ' + (active ? 'active' : '')} disabled={disabled} onClick={onClick} aria-pressed={active}>
      {icon}<span><strong>{label}</strong><small>{hint}</small></span>
    </button>
  );
}
