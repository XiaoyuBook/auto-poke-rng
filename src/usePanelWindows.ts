import { useEffect, useState } from 'react';
import type { LogSource, PanelWindowState } from './desktop';

export function usePanelWindows() {
  const [state, setState] = useState<PanelWindowState>({ detached: [], logs: [], logSource: '全部来源', alwaysOnTop: false });
  const [error, setError] = useState('');
  const api = window.desktop?.panels;

  useEffect(() => {
    if (!api) return;
    let active = true;
    let receivedUpdate = false;
    const unsubscribe = api.onState(next => { receivedUpdate = true; setState(next); });
    api.getState().then(next => {
      if (active && !receivedUpdate) setState(next);
    }).catch(() => { if (active) setError('窗口状态同步失败，请重新打开窗口。'); });
    return () => { active = false; unsubscribe(); };
  }, [api]);

  const setLogSource = (source: LogSource) => {
    if (api) void api.setLogSource(source).catch(() => setError('日志筛选同步失败，请重试。'));
    else setState(current => ({ ...current, logSource: source }));
  };

  return { state, setLogSource, error, setError };
}
