import { Bell, BookOpen, Check, CheckCircle2, Copy, Eye, EyeOff, MessageCircle, Send, ShieldCheck, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { QQGuide } from './QQGuide';
import { qqStatusLabels, useQQState, type QQRecipient, type QQRecord, type QQState } from '../notifications';

const recipientLabels = { user: '私聊', group: '群聊' };
const resultLabels: Record<QQRecord['text'], string> = { submitted: '已提交', failed: '失败／未确认', skipped: '未发送' };

export function QQNotifications({ close }: { close: () => void }) {
  const { api, state, error: loadError } = useQQState();
  const [tab, setTab] = useState<'setup' | 'records' | 'guide'>('setup');
  const [appId, setAppId] = useState('');
  const [secret, setSecret] = useState('');
  const [remember, setRemember] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [closing, setClosing] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const bindingPanel = useRef<HTMLDivElement>(null);
  const hasBinding = Boolean(state?.binding);
  useEffect(() => {
    if (state && !dirty) { setAppId(state.settings.appId); setRemember(state.settings.rememberSecret); }
  }, [state, dirty]);
  useEffect(() => () => { void api?.cancel(true).catch(() => {}); }, [api]);
  useEffect(() => { if (content.current) content.current.scrollTop = 0; }, [tab]);
  useEffect(() => { if (hasBinding) bindingPanel.current?.scrollIntoView?.({ block: 'nearest' }); }, [hasBinding]);
  const busy = pending || Boolean(state?.operation);
  const command = async (action: () => Promise<QQState>) => {
    setError(''); setPending(true);
    try { return await action(); }
    catch (reason) { setError(String((reason as Error).message || reason).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    finally { setPending(false); }
  };
  const save = async () => {
    if (!api) return;
    const result = await command(() => api.save({ appId, rememberSecret: remember, ...(secret ? { secret } : {}) }));
    if (result) { setDirty(false); setSecret(''); }
  };
  const changeTab = (next: typeof tab) => {
    if (next !== 'setup') void api?.cancel(true).catch(() => {});
    setError(''); setTab(next);
  };
  const requestClose = () => { if (dirty) setClosing(true); else close(); };
  const toggleRecipient = (kind: QQRecipient, enabled: boolean) => {
    if (api) void command(() => api.save({ [kind + 'Enabled']: enabled }));
  };
  const problem = error || loadError || state?.error;
  return <Dialog title="QQ 通知" close={requestClose} className="qq-dialog">
    <div className="qq-intro"><div className="qq-feature"><Bell size={22} /></div><div><strong>把消息发送到 QQ</strong><p>连接你的机器人，绑定接收方并验证图文发送。</p></div>
      <span className={'qq-badge ' + (state?.status || '')}>{qqStatusLabels[state?.status || 'unconfigured']}</span>
    </div>
    <div className="qq-tabs" role="tablist" aria-label="QQ 通知设置">
      {([['setup', '接入设置'], ['records', '发送记录'], ['guide', '注册与绑定说明']] as const).map(([id, label]) =>
        <button key={id} type="button" role="tab" id={'qq-tab-' + id} aria-controls={'qq-panel-' + id} aria-selected={tab === id} onClick={() => changeTab(id)}>{id === 'guide' && <BookOpen size={14} />}{label}{id === 'records' && Boolean(state?.records.length) && <span>{state?.records.length}</span>}</button>)}
    </div>
    <div className="qq-content" ref={content} role="tabpanel" id={'qq-panel-' + tab} aria-labelledby={'qq-tab-' + tab}>
      {!api && <p className="qq-empty">请在桌面应用中配置和使用 QQ 通知。</p>}
      {api && !state && !loadError && <p className="qq-empty">正在读取通知配置…</p>}
      {tab === 'setup' && state && <div className="qq-setup">
        <div className="qq-forms">
          <section className="qq-section"><h3><span>1</span>机器人凭据</h3>
            <div className="qq-field"><label htmlFor="qq-app-id">AppID</label><input id="qq-app-id" value={appId} maxLength={128} autoComplete="off" spellCheck={false} disabled={busy} placeholder="从 QQ 开放平台复制 AppID" onChange={event => { setAppId(event.target.value); setDirty(true); }} /></div>
            <div className="qq-field"><label htmlFor="qq-secret">AppSecret</label><div className="qq-secret"><input id="qq-secret" type={showSecret ? 'text' : 'password'} value={secret} maxLength={512} autoComplete="off" spellCheck={false} disabled={busy} placeholder={state.hasSecret ? '已保存密钥，输入新值可替换' : '填写机器人密钥'} onChange={event => { setSecret(event.target.value); setDirty(true); }} /><button type="button" className="icon-button" aria-label={showSecret ? '隐藏密钥' : '显示密钥'} onClick={() => setShowSecret(value => !value)}>{showSecret ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></div>
            <label className="qq-checkbox"><input type="checkbox" checked={remember} disabled={busy} onChange={event => { setRemember(event.target.checked); setDirty(true); }} />记住密钥<span>使用系统加密保存</span></label>
            <div className="qq-actions"><button className="button" disabled={busy || !dirty} onClick={() => void save()}>保存设置</button><button className="button" disabled={busy || dirty || !state.hasSecret || !state.settings.appId} onClick={() => void command(() => api!.verify())}><ShieldCheck size={14} />验证凭据</button>{state.hasSecret && <button className="qq-text-button" disabled={busy || dirty} onClick={() => void command(() => api!.save({ secret: '', rememberSecret: false }))}>清除密钥</button>}</div>
            <p className="qq-hint">{dirty ? '有未保存的更改，请保存后继续。' : state.verified ? '凭据已验证，可以绑定接收方。' : 'AppSecret 不会显示在日志中；不勾选记住时，仅本次打开有效。'}</p>
          </section>
          <section className="qq-section"><h3><span>2</span>接收方</h3><p className="qq-hint">可同时选择一个私聊和一个群聊。</p>
            {(['user', 'group'] as const).map(kind => <div className="qq-recipient" key={kind}>
              <label><input type="checkbox" aria-label={'发送到' + recipientLabels[kind]} checked={state.settings[kind === 'user' ? 'userEnabled' : 'groupEnabled']} disabled={busy || dirty} onChange={event => toggleRecipient(kind, event.target.checked)} />{kind === 'user' ? <MessageCircle size={17} /> : <Users size={17} />}<span><strong>QQ {recipientLabels[kind]}</strong><small>{state.settings[kind === 'user' ? 'userOpenId' : 'groupOpenId'] ? '已绑定 · ' + state.settings[kind === 'user' ? 'userOpenId' : 'groupOpenId'].slice(-8) : '尚未绑定'}</small></span></label>
              <button className="button" disabled={busy || dirty || !state.verified} onClick={() => void command(() => api!.bind(kind))}>{state.settings[kind === 'user' ? 'userOpenId' : 'groupOpenId'] ? '重新绑定' : '绑定' + recipientLabels[kind]}</button>
              {state.settings[kind === 'user' ? 'userOpenId' : 'groupOpenId'] && <button className="qq-text-button" disabled={busy || dirty} onClick={() => void command(() => api!.unbind(kind))}>解除</button>}
            </div>)}
            {state.binding && <div className="qq-binding" ref={bindingPanel} aria-live="polite"><p>请{state.binding.kind === 'user' ? '私聊机器人' : '在目标群内 @机器人'}，发送当前绑定码</p><div><strong>{state.binding.code}</strong><button className="icon-button" title="复制绑定码" aria-label="复制绑定码" onClick={() => void navigator.clipboard.writeText(state.binding!.code).then(() => setCopied(state.binding!.code)).catch(() => setError('复制失败，请手动输入绑定码。'))}>{copied === state.binding.code ? <Check size={16} /> : <Copy size={16} />}</button><span>{state.binding.seconds} 秒</span></div><small>每 60 秒自动换码，旧码立即失效。离开此页或关闭窗口会停止绑定。</small></div>}
          </section>
        </div>
        <aside className="qq-test"><h3><span>3</span>图文测试</h3><p>发送一条测试文字和一张测试图，确认 QQ 中两者都能收到。</p>
          <div className="qq-message"><span>Auto Poke RNG</span><p>QQ 通知测试<br />请确认文字和图片均已收到。</p><div className="qq-test-picture" aria-label="精灵球通知测试图"><div /></div><small>软件内置测试图</small></div>
          <button className="button primary" disabled={busy || dirty || !state.ready} onClick={() => void command(() => api!.sendTest())}><Send size={14} />发送图文测试</button>
          {state.testSent && !state.testConfirmed && <button className="button" disabled={busy || dirty} onClick={() => void command(() => api!.confirmTest())}>我已收到文字和图片</button>}
          {state.testConfirmed && <p className="qq-confirmed"><CheckCircle2 size={16} />图文接收已确认</p>}
          <small>发送到已勾选的接收方。接口提交成功后，请在 QQ 中核对。</small>
        </aside>
      </div>}
      {tab === 'records' && <><div className="qq-section-heading"><h3>发送记录</h3><span>本次打开期间 · 最近 100 条</span></div><p className="qq-hint">文字与图片分别记录提交结果。失败或取消不会自动重发。</p>
        {!state?.records.length ? <div className="qq-empty"><Send size={28} /><strong>暂无发送记录</strong><p>完成绑定后，发送一次图文测试。</p></div> : <div className="qq-records">{state.records.map(record => <article key={record.id} className="qq-record"><div><strong>{record.event} · QQ {recipientLabels[record.kind]}</strong><time>{new Date(record.time).toLocaleString('zh-CN', { hour12: false })}</time></div><div className={record.success ? 'qq-result-ok' : 'qq-result-error'}>文字：{resultLabels[record.text]}<span>图片：{resultLabels[record.image]}</span></div><p>{record.detail}</p></article>)}</div>}
      </>}
      {tab === 'guide' && <QQGuide openSetup={() => changeTab('setup')} />}
    </div>
    <footer className="qq-footer"><p role={problem ? 'alert' : 'status'} className={problem ? 'qq-result-error' : ''}>{problem || state?.feedback || '配置 QQ 机器人后即可测试发送。'}</p>
      {state?.operation && <button className="button" onClick={() => void api?.cancel().catch(() => setError('取消失败，请重试。'))}>取消当前操作</button>}
      <button className="button" onClick={requestClose}>关闭</button>
    </footer>
    {closing && <div className="qq-close-confirm" role="alert"><span>接入设置尚未保存。</span><button className="button" onClick={() => setClosing(false)}>继续编辑</button><button className="button" onClick={close}>放弃更改并关闭</button></div>}
  </Dialog>;
}
