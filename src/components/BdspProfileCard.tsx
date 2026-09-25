import type { BdspProfile } from '../bdspProfile';
import { useState } from 'react';
import { BdspProfileDialog } from './BdspProfileDialog';

type ProfileProps = { profile: BdspProfile; onChange: (profile: BdspProfile) => void };
export function BdspProfileCard({ profile, onChange }: ProfileProps) {
  const [managing, setManaging] = useState(false);
  const set = (patch: Partial<BdspProfile>) => onChange({ ...profile, ...patch });
  const trainerId = (text: string) => Math.min(65535, Number(text.replace(/\D/g, '')) || 0);
  return <section className="static-profile-card" aria-label="存档信息">
    <label>名称<input aria-label="存档名称" value={profile.name} onChange={event => set({ name: event.target.value })} /></label>
    <button className="button static-manage" type="button" onClick={() => setManaging(true)}>管理</button>
    <label>TID<input aria-label="TID" inputMode="numeric" value={profile.tid} onChange={event => set({ tid: trainerId(event.target.value) })} /></label>
    <label>SID<input aria-label="SID" inputMode="numeric" value={profile.sid} onChange={event => set({ sid: trainerId(event.target.value) })} /></label>
    <label>TSV<input aria-label="TSV" value={profile.tid ^ profile.sid} readOnly /></label>
    <label>游戏<select aria-label="存档游戏版本" value={profile.version} onChange={event => set({ version: event.target.value as BdspProfile['version'] })}><option value="BD">晶灿钻石</option><option value="SP">明亮珍珠</option></select></label>
    <label className="static-check"><input type="checkbox" checked={profile.dex} onChange={event => set({ dex: event.target.checked })} />全国图鉴</label>
    <label className="static-check"><input type="checkbox" checked={profile.charm} onChange={event => set({ charm: event.target.checked })} />闪耀护符</label>
    <label className="static-check"><input type="checkbox" checked={profile.oval} onChange={event => set({ oval: event.target.checked })} />圆形护符</label>
    {managing && <BdspProfileDialog profile={profile} apply={onChange} close={() => setManaging(false)} />}
  </section>;
}
export function BdspHomeWorkspace({ profile, onChange, onOpenScript }: ProfileProps & { onOpenScript: () => void }) {
  return <section className="bdsp-home-workspace" aria-label="珍钻复刻首页">
    <header className="bdsp-home-heading"><div><h2>珍钻复刻</h2><p>管理 BDSP 存档信息，并从左侧进入定点数据或 OCR 设置。</p></div></header>
    <BdspProfileCard profile={profile} onChange={onChange} />
    <div className="bdsp-home-empty"><h3>准备开始</h3><p>脚本编辑、定点数据和 OCR 设置都使用当前珍钻复刻工作区。</p><button className="button" type="button" onClick={onOpenScript}>打开脚本编辑</button></div>
  </section>;
}
