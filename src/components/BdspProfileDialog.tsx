import { useState } from 'react';
import type { BdspProfile } from '../bdspProfile';
import { Dialog } from './Dialog';

export function BdspProfileDialog({ profile, apply, close }: { profile: BdspProfile; apply: (profile: BdspProfile) => void; close: () => void }) {
  const [draft, setDraft] = useState({ ...profile, tid: String(profile.tid), sid: String(profile.sid) });
  const [error, setError] = useState('');
  const idValid = (text: string) => /^\d+$/.test(text) && Number(text) <= 65535;
  const set = (patch: Partial<typeof draft>) => { setDraft(current => ({ ...current, ...patch })); setError(''); };
  return <Dialog title="存档信息管理" close={close} className="bdsp-profile-dialog">
    <form className="bdsp-tool-body" onSubmit={event => {
      event.preventDefault();
      if (!idValid(draft.tid) || !idValid(draft.sid)) { setError('TID 和 SID 须为 0–65535 的整数。'); return; }
      apply({ ...draft, name: draft.name.trim() || '-', tid: Number(draft.tid), sid: Number(draft.sid) });
      close();
    }}>
      <div className="bdsp-profile-fields">
        <label>名称<input aria-label="存档名称" value={draft.name} onChange={event => set({ name: event.target.value })} autoFocus /></label>
        <label>游戏<select aria-label="存档游戏版本" value={draft.version} onChange={event => set({ version: event.target.value as BdspProfile['version'] })}><option value="BD">晶灿钻石</option><option value="SP">明亮珍珠</option></select></label>
        <label>TID<input aria-label="TID" inputMode="numeric" value={draft.tid} onChange={event => set({ tid: event.target.value })} /></label>
        <label>SID<input aria-label="SID" inputMode="numeric" value={draft.sid} onChange={event => set({ sid: event.target.value })} /></label>
        <label>TSV<output aria-label="TSV">{idValid(draft.tid) && idValid(draft.sid) ? Number(draft.tid) ^ Number(draft.sid) : '—'}</output></label>
      </div>
      <div className="bdsp-profile-flags">
        <label className="static-check"><input type="checkbox" checked={draft.dex} onChange={event => set({ dex: event.target.checked })} />全国图鉴</label>
        <label className="static-check"><input type="checkbox" checked={draft.charm} onChange={event => set({ charm: event.target.checked })} />闪耀护符</label>
        <label className="static-check"><input type="checkbox" checked={draft.oval} onChange={event => set({ oval: event.target.checked })} />圆形护符</label>
      </div>
      {error && <p className="bdsp-tool-error" role="alert">{error}</p>}
      <footer className="bdsp-tool-actions"><button className="button" type="button" onClick={close}>取消</button><button className="button primary" type="submit">保存并应用</button></footer>
    </form>
  </Dialog>;
}
