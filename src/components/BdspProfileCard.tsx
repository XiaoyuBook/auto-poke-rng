import { useState } from 'react';

export function BdspProfileCard() {
  const [profile, setProfile] = useState({ name: '-', tid: '12345', sid: '54321', dex: false, charm: false, oval: false });
  return <section className="static-profile-card" aria-label="存档信息">
    <label>名称<input aria-label="存档名称" value={profile.name} onChange={event => setProfile(current => ({ ...current, name: event.target.value }))} /></label>
    <button className="button static-manage" type="button" disabled>管理</button>
    <label>TID<input aria-label="TID" value={profile.tid} onChange={event => setProfile(current => ({ ...current, tid: event.target.value.replace(/\D/g, '').slice(0, 5) }))} /></label>
    <label>SID<input aria-label="SID" value={profile.sid} onChange={event => setProfile(current => ({ ...current, sid: event.target.value.replace(/\D/g, '').slice(0, 5) }))} /></label>
    <label>TSV<input aria-label="TSV" value={String((Number(profile.tid) ^ Number(profile.sid)) >>> 0)} readOnly /></label>
    <span className="static-profile-game">游戏 <strong>晶灿钻石</strong></span>
    <label className="static-check"><input type="checkbox" checked={profile.dex} onChange={event => setProfile(current => ({ ...current, dex: event.target.checked }))} />全国图鉴</label>
    <label className="static-check"><input type="checkbox" checked={profile.charm} onChange={event => setProfile(current => ({ ...current, charm: event.target.checked }))} />闪耀护符</label>
    <label className="static-check"><input type="checkbox" checked={profile.oval} onChange={event => setProfile(current => ({ ...current, oval: event.target.checked }))} />圆形护符</label>
  </section>;
}

export function BdspHomeWorkspace({ onOpenScript }: { onOpenScript: () => void }) {
  return <section className="bdsp-home-workspace" aria-label="珍钻复刻首页">
    <header className="bdsp-home-heading"><div><h2>珍钻复刻</h2><p>管理 BDSP 存档信息，并从左侧进入定点数据或 OCR 设置。</p></div></header>
    <BdspProfileCard />
    <div className="bdsp-home-empty"><h3>准备开始</h3><p>脚本编辑、定点数据和 OCR 设置都使用当前珍钻复刻工作区。</p><button className="button" type="button" onClick={onOpenScript}>打开脚本编辑</button></div>
  </section>;
}
