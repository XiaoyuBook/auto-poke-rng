import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Gamepad2 } from 'lucide-react';
import { useDevices } from '../useDevices';
import { resolveKeyboardButton, type ControllerButton } from '../controllerMapping';

export function Controller({ onInput }: { onInput: (key: string) => void }) {
  const { controller } = useDevices();
  const api = window.desktop?.devices?.controller;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastInput, setLastInput] = useState('等待输入');
  const held = useRef(new Set<ControllerButton>());
  const clicking = useRef<Promise<void> | null>(null);
  const connected = controller.status === 'connected';
  const enabled = connected && !controller.owned && !controller.running && !busy;
  const ready = useRef(enabled);
  ready.current = enabled;

  const reportError = (value: unknown) => setError(value instanceof Error ? value.message : String(value));
  // A click is a short asynchronous sequence. Delay key-up/reset until it
  // finishes so an in-flight press cannot overwrite the release report.
  const releaseAfterClick = (action: () => Promise<unknown>) => {
    void Promise.resolve(clicking.current).then(action).catch(reportError);
  };

  useEffect(() => {
    if (!api) return;
    const release = () => {
      if (!held.current.size) return;
      held.current.clear();
      releaseAfterClick(() => api.reset());
    };
    const keydown = (event: KeyboardEvent) => {
      if (!ready.current || clicking.current || event.repeat || event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName)) return;
      const key = resolveKeyboardButton(event.key);
      if (!key || held.current.has(key)) return;
      event.preventDefault();
      held.current.add(key);
      setLastInput(key);
      void api.key(key, true).catch(reportError);
    };
    const keyup = (event: KeyboardEvent) => {
      const key = resolveKeyboardButton(event.key);
      if (!key || !held.current.delete(key)) return;
      event.preventDefault();
      releaseAfterClick(() => api.key(key, false));
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', release);
      release();
    };
  }, [api]);

  const press = (key: ControllerButton) => {
    setLastInput(key);
    onInput(key);
    if (!api || !enabled || clicking.current) return;
    const pending = api.press(key).then(() => undefined).catch(reportError);
    clicking.current = pending;
    void pending.finally(() => {
      if (clicking.current === pending) clicking.current = null;
    });
  };

  const stop = async () => {
    if (!api) return;
    setBusy(true);
    held.current.clear();
    try {
      await api.stop();
    } catch (value) {
      reportError(value);
    } finally {
      setBusy(false);
    }
  };

  const disabled = Boolean(api) && !enabled;
  return <>
    <p className="dialog-intro">虚拟手柄通过已连接的伊机控发送输入。鼠标点击和键盘映射使用同一套按键状态。</p>
    <div className="controller-status-line" data-status={connected ? 'connected' : 'idle'}>
      <span className={'status-dot ' + (connected ? 'success' : 'warning')} />
      <span>{connected ? `单片机已连接${controller.name ? ` · ${controller.name}` : ''}` : '单片机未连接'}</span>
    </div>
    <div className="controller-preview">
      <div className="dpad">
        <button disabled={disabled} className="up" aria-label="向上" onClick={() => press('UP')}><ArrowUp size={16} /></button>
        <button disabled={disabled} className="left" aria-label="向左" onClick={() => press('LEFT')}><ArrowLeft size={16} /></button>
        <span className="dpad-center" />
        <button disabled={disabled} className="right" aria-label="向右" onClick={() => press('RIGHT')}><ArrowRight size={16} /></button>
        <button disabled={disabled} className="down" aria-label="向下" onClick={() => press('DOWN')}><ArrowDown size={16} /></button>
      </div>
      <div className="controller-center"><Gamepad2 size={22} /><output aria-live="polite">{lastInput}</output><button disabled={disabled} aria-label="菜单加号" onClick={() => press('PLUS')}>+</button></div>
      <div className="face-buttons">{['X', 'Y', 'A', 'B'].map(key => <button disabled={disabled} key={key} className={'key-' + key} onClick={() => press(key as ControllerButton)}>{key}</button>)}</div>
    </div>
    {(error || controller.message) && <p className="device-error" role="alert">{error || controller.message}</p>}
    <p className="dialog-footnote">{!api ? '输入仅在浏览器预览，不会发送到设备。' : controller.owned ? '脚本正在使用手柄，手动输入已锁定。' : controller.running ? '设备正在执行脚本，手动输入已锁定。' : connected ? '手动输入可用。' : '请先在左上角“伊机控”中连接单片机。'}</p>
    {api && connected && <button className="button" disabled={busy} onClick={() => void stop()}>停止并释放全部按键</button>}
  </>;
}
