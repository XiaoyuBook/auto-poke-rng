import { useEffect, useState } from 'react';
import { Copy, Plus, Save } from 'lucide-react';
import { FRLG_GAMES, type FrlgGame } from '../frlgAutomation';
import { useFrlgSaves, type FrlgSaveProfile } from '../frlgProfile';
import type { FrlgDexRoute } from '../frlgDex';
import { FrlgPokedex } from './FrlgPokedex';

const gameLabels: Record<string, string> = {
  fr_nx: '火红 · 美版 · Switch 1', fr_nx2: '火红 · 美版 · Switch 2',
  lg_nx: '叶绿 · 美版 · Switch 1', lg_nx2: '叶绿 · 美版 · Switch 2',
  fr_jpn_nx: '火红 · 日版 · Switch 1', fr_jpn_nx2: '火红 · 日版 · Switch 2',
  lg_jpn_nx: '叶绿 · 日版 · Switch 1', lg_jpn_nx2: '叶绿 · 日版 · Switch 2',
};

type SaveManager = ReturnType<typeof useFrlgSaves>;

export function FrlgHomeWorkspace({ saves, onOpenAutomation }: { saves: SaveManager; onOpenAutomation: (route?: FrlgDexRoute) => void }) {
  const profile = saves.active;
  const [draft, setDraft] = useState<FrlgSaveProfile>({ ...profile });
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setDraft({ ...profile }); setFeedback(''); setError(''); }, [profile.id]);
  const dirty = (['name', 'trainerName', 'game', 'tid', 'sid'] as const).some(key => draft[key] !== profile[key]);
  const update = <K extends keyof FrlgSaveProfile>(key: K, value: FrlgSaveProfile[K]) => { setDraft(current => ({ ...current, [key]: value })); setFeedback(''); setError(''); };
  const save = () => {
    const name = draft.name.trim();
    if (!name) { setError('请填写存档名称。'); return; }
    if (![draft.tid, draft.sid].every(value => Number.isInteger(value) && value >= 0 && value <= 65535)) { setError('TID 和 SID 须为 0–65535 的整数。'); return; }
    saves.save({ ...draft, completedSpecies: profile.completedSpecies, name, trainerName: draft.trainerName.trim() || '-' });
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
  const chooseTarget = (route?: FrlgDexRoute) => {
    if (dirty) { setFeedback('当前存档有未保存修改，请先保存后再选择目标。'); return; }
    onOpenAutomation(route);
  };
  return <section className="frlg-home-workspace" aria-label="火叶首页">
    <header className="frlg-home-heading"><div><h2>火叶图鉴</h2><p>每个存档，记录自己的乱数进度。</p></div><button type="button" onClick={() => chooseTarget()}>进入自动流程</button></header>
    <section className="frlg-save-card" aria-label="火叶存档信息">
      <div className="frlg-save-toolbar"><label>存档槽<select aria-label="当前火叶存档" value={saves.activeId} onChange={event => select(event.target.value)}>{saves.profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="frlg-save-card-actions"><button type="button" onClick={() => create(false)}><Plus size={14} />新建存档</button><button type="button" onClick={() => create(true)}><Copy size={14} />复制当前存档</button></div></div>
      <details className="frlg-save-editor"><summary><strong>存档资料</strong><span>{gameLabels[profile.game]} · TID {profile.tid} / SID {profile.sid}</span><small className={dirty ? 'frlg-save-dirty' : 'frlg-save-clean frlg-save-feedback'} role="status">{dirty ? '有未保存修改' : feedback || '已保存'}</small></summary>
      <div className="frlg-save-fields">
        <label>存档名称<input aria-label="火叶存档名称" value={draft.name} onChange={event => update('name', event.target.value)} /></label>
        <label>训练家名称<input aria-label="训练家名称" value={draft.trainerName} onChange={event => update('trainerName', event.target.value)} /></label>
        <label>游戏版本<select aria-label="火叶存档游戏版本" value={draft.game} onChange={event => update('game', event.target.value as FrlgGame)}>{FRLG_GAMES.map(game => <option key={game} value={game}>{gameLabels[game]}</option>)}</select></label>
        <label>TID<input aria-label="火叶存档 TID" type="number" min={0} max={65535} value={draft.tid} onChange={event => update('tid', Number(event.target.value))} /></label>
        <label>SID<input aria-label="火叶存档 SID" type="number" min={0} max={65535} value={draft.sid} onChange={event => update('sid', Number(event.target.value))} /></label>
        <label>TSV<output aria-label="火叶存档 TSV">{draft.tid ^ draft.sid}</output></label>
      </div>
      <footer className="frlg-save-card-footer"><button type="button" className="button primary" disabled={!dirty} onClick={save}><Save size={14} />保存当前存档</button></footer>
      </details>
      {error && <p className="panel-error" role="alert">{error}</p>}
      {dirty && feedback && <p className="frlg-save-feedback" role="status">{feedback}</p>}
    </section>
    <FrlgPokedex key={profile.id} profile={profile} onComplete={saves.setSpeciesCompleted} onChooseTarget={chooseTarget}/>
  </section>;
}
