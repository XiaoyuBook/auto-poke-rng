import { useEffect, useState } from 'react';
import { Copy, Plus, Save } from 'lucide-react';
import { FRLG_GAMES, type FrlgGame } from '../frlgAutomation';
import { useFrlgSaves, type FrlgSaveProfile } from '../frlgProfile';

const gameLabels: Record<string, string> = {
  fr_nx: '火红 · 美版 · Switch 1', fr_nx2: '火红 · 美版 · Switch 2',
  lg_nx: '叶绿 · 美版 · Switch 1', lg_nx2: '叶绿 · 美版 · Switch 2',
  fr_jpn_nx: '火红 · 日版 · Switch 1', fr_jpn_nx2: '火红 · 日版 · Switch 2',
  lg_jpn_nx: '叶绿 · 日版 · Switch 1', lg_jpn_nx2: '叶绿 · 日版 · Switch 2',
};

type SaveManager = ReturnType<typeof useFrlgSaves>;

export function FrlgHomeWorkspace({ saves, onOpenAutomation }: { saves: SaveManager; onOpenAutomation: () => void }) {
  const profile = saves.active;
  const [draft, setDraft] = useState<FrlgSaveProfile>({ ...profile });
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setDraft({ ...profile }); setFeedback(''); setError(''); }, [profile.id]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);
  const update = <K extends keyof FrlgSaveProfile>(key: K, value: FrlgSaveProfile[K]) => { setDraft(current => ({ ...current, [key]: value })); setFeedback(''); setError(''); };
  const save = () => {
    const name = draft.name.trim();
    if (!name) { setError('请填写存档名称。'); return; }
    if (![draft.tid, draft.sid].every(value => Number.isInteger(value) && value >= 0 && value <= 65535)) { setError('TID 和 SID 须为 0–65535 的整数。'); return; }
    saves.save({ ...draft, name, trainerName: draft.trainerName.trim() || '-' });
    setFeedback('当前存档已保存。'); setError('');
  };
  const select = (id: string) => {
    if (dirty) { setFeedback('当前存档有未保存修改，请先保存后再切换。'); return; }
    saves.select(id);
  };
  const create = (copy: boolean) => {
    if (dirty) { setFeedback('当前存档有未保存修改，请先保存后再新建。'); return; }
    saves.create(copy ? profile : undefined);
    setFeedback(copy ? '已创建当前存档副本。' : '已创建新的空白存档。');
  };
  return <section className="frlg-home-workspace" aria-label="火叶首页">
    <header className="frlg-home-heading"><div><h2>火叶</h2><p>管理独立的火红／叶绿存档信息；每个存档槽的训练家资料和图鉴状态分别保存。</p></div></header>
    <section className="frlg-save-card" aria-label="火叶存档信息">
      <header className="frlg-save-card-heading">
        <div><span>当前存档</span><strong>{profile.name}</strong></div>
        <div className="frlg-save-card-actions"><button type="button" onClick={() => create(false)}><Plus size={14} />新建存档</button><button type="button" onClick={() => create(true)}><Copy size={14} />复制当前存档</button></div>
      </header>
      <div className="frlg-save-toolbar"><label>存档槽<select aria-label="当前火叶存档" value={saves.activeId} onChange={event => select(event.target.value)}>{saves.profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><span className={dirty ? 'frlg-save-dirty' : 'frlg-save-clean'}>{dirty ? '有未保存修改' : feedback || '已保存'}</span></div>
      <div className="frlg-save-fields">
        <label>存档名称<input aria-label="火叶存档名称" value={draft.name} onChange={event => update('name', event.target.value)} /></label>
        <label>训练家名称<input aria-label="训练家名称" value={draft.trainerName} onChange={event => update('trainerName', event.target.value)} /></label>
        <label>游戏版本<select aria-label="火叶存档游戏版本" value={draft.game} onChange={event => update('game', event.target.value as FrlgGame)}>{FRLG_GAMES.map(game => <option key={game} value={game}>{gameLabels[game]}</option>)}</select></label>
        <label>TID<input aria-label="火叶存档 TID" type="number" min={0} max={65535} value={draft.tid} onChange={event => update('tid', Number(event.target.value))} /></label>
        <label>SID<input aria-label="火叶存档 SID" type="number" min={0} max={65535} value={draft.sid} onChange={event => update('sid', Number(event.target.value))} /></label>
        <label>TSV<output aria-label="火叶存档 TSV">{draft.tid ^ draft.sid}</output></label>
      </div>
      <div className="frlg-save-flags"><label><input type="checkbox" checked={draft.dexCompleted} onChange={event => update('dexCompleted', event.target.checked)} />已完成全国图鉴</label><span>该状态只属于当前存档槽</span></div>
      {(error || feedback) && <p className={error ? 'panel-error' : 'frlg-save-feedback'} role={error ? 'alert' : 'status'}>{error || feedback}</p>}
      <footer className="frlg-save-card-footer"><button type="button" className="button primary" disabled={!dirty} onClick={save}><Save size={14} />保存当前存档</button><button type="button" className="button" onClick={onOpenAutomation}>进入自动流程</button></footer>
    </section>
    <div className="frlg-home-note"><h3>独立存档数据</h3><p>新建或复制存档不会覆盖已有存档；自动流程使用当前激活存档的游戏版本、TID 和 SID。</p></div>
  </section>;
}
