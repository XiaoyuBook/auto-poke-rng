import { useEffect, useState } from 'react';

export type QQRecipient = 'user' | 'group';
export type QQStatus = 'unconfigured' | 'unverified' | 'unbound' | 'ready' | 'busy' | 'failed';
export interface QQSettings {
  appId: string; rememberSecret: boolean; userOpenId: string; groupOpenId: string;
  userEnabled: boolean; groupEnabled: boolean;
}
export interface QQRecord {
  id: string; time: string; event: string; kind: QQRecipient; success: boolean; detail: string;
  text: 'submitted' | 'failed' | 'skipped'; image: 'submitted' | 'failed' | 'skipped';
}
export interface QQState {
  settings: QQSettings; hasSecret: boolean; ready: boolean; verified: boolean;
  operation: '' | 'verify' | 'bind' | 'test' | 'send';
  binding: null | { kind: QQRecipient; code: string; seconds: number; generation: number };
  feedback: string; error: string; status: QQStatus; testSent: boolean; testConfirmed: boolean; records: QQRecord[];
}
export interface QQApi {
  getState: () => Promise<QQState>;
  save: (values: Partial<Pick<QQSettings, 'appId' | 'rememberSecret' | 'userEnabled' | 'groupEnabled'>> & { secret?: string }) => Promise<QQState>;
  verify: () => Promise<QQState>;
  bind: (kind: QQRecipient) => Promise<QQState>;
  unbind: (kind: QQRecipient) => Promise<QQState>;
  sendTest: () => Promise<QQState>;
  confirmTest: () => Promise<QQState>;
  cancel: (bindingOnly?: boolean) => Promise<QQState>;
  onState: (listener: (state: QQState) => void) => () => void;
}
export const qqStatusLabels: Record<QQStatus, string> = {
  unconfigured: '未配置', unverified: '待验证凭据', unbound: '待绑定接收方', ready: '可发送', busy: '正在操作', failed: '需检查',
};

export function useQQState() {
  const api = window.desktop?.notifications;
  const [state, setState] = useState<QQState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!api) return;
    let active = true, received = false;
    const unsubscribe = api.onState(value => { received = true; if (active) { setState(value); setError(''); } });
    void api.getState().then(value => { if (active && !received) setState(value); }).catch(() => { if (active) setError('无法读取 QQ 通知配置，请关闭窗口后重试。'); });
    return () => { active = false; unsubscribe(); };
  }, [api]);
  return { api, state, error };
}
