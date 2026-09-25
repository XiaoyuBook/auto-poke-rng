import { useState } from 'react';
import { Eye, Play, Square, Save, Clock3, FolderOpen, ChevronDown, Plus } from 'lucide-react';
import { newBlinkConfig, type BlinkController, type BlinkMode } from '../blink';
import type { VideoState } from '../devices';

const timingFields = [
  ['npc', 'NPC 数', '眨眼NPC数', 0, 999, 1, '玩家眨眼捕获和持续推进时的 NPC 数量'],
  ['timeDelay', '时间延迟', '眨眼时间延迟', 0, 999, .1, 'Timeline 切换后等待的秒数'],
  ['advanceDelay', '帧数延迟', '眨眼帧数延迟', 0, 9999, 1, '时间延迟结束后一次性增加的推进数'],
  ['advanceDelay2', '帧数延迟 2', '眨眼帧数延迟2', 0, 9999, 1, 'Timeline 第 11 次事件前追加一次'],
  ['timelineNpc', 'Timeline NPC 数', 'Timeline NPC 数', -1, 999, 1, '每 1.017 秒的推进来源数为此值 +1；-1 表示没有此类来源'],
  ['pokemonNpc', '宝可梦 NPC 数', '宝可梦 NPC 数', 0, 999, 1, 'Timeline 中使用随机眨眼间隔的宝可梦数量'],
] as const;

export function BlinkWorkspace({ blink, video }: { blink: BlinkController; video: VideoState }) {
  const [configsOpen, setConfigsOpen] = useState(false);
  const { config, setConfig, state, busy } = blink;
  const update = (values: Partial<typeof config>) => setConfig(current => ({ ...current, ...values }));
  const rect = config.roi;
  const ready = Boolean(config.eye && rect && video.status === 'connected' && config.sourceWidth === video.width && config.sourceHeight === video.height);
  const locked = busy || Boolean(blink.selection) || blink.selecting;
  const unavailable = !ready || Boolean(blink.selection) || blink.selecting || (busy && state.status !== 'tracking') || !window.desktop?.blink;
  const capturing = ['starting', 'capturing', 'solving'].includes(state.status) || (state.status === 'stopping' && !state.tracking);
  const hasSeed = config.seed.length === 4 && config.seed.every(word => /^[\da-f]{1,8}$/i.test(word)) && config.seed.some(word => !/^0+$/.test(word));
  const actionButton = (mode: BlinkMode, label: string, primary = false) => {
    const active = capturing && state.mode === mode;
    return <button className={'button' + (active ? ' danger' : primary ? ' primary' : '')} type="button"
      aria-label={active ? `停止${label}` : label}
      title={mode === 'reidentify' && !active && !hasSeed ? '先捕捉 Seed 或选择已有配置，再进行校正' : undefined}
      disabled={active ? state.status === 'stopping' : unavailable}
      onClick={() => {
        if (active) { void blink.stop(); return; }
        if (mode === 'reidentify' && !hasSeed) { blink.setNotice('请先捕捉 Seed 或选择已有配置，再进行校正。'); return; }
        void blink.run(mode);
      }}>{active ? <><Square size={13} />停止</> : <>{mode === 'recover' && <Play size={14} />}{label}</>}</button>;
  };
  const message = blink.notice || (state.status === 'error' ? state.message : !busy && ready ? blink.observation?.error : '');
  const messageError = !blink.notice && (state.status === 'error' || Boolean(blink.observation?.error));
  return <section className="blink-workspace" aria-label="眨眼捕获工作区">
    <header className="blink-heading"><Eye size={18} /><h2>眨眼捕获</h2><span>Project_Xs</span></header>
    <div className="blink-scroll">
      <div className="blink-form">
        <section className="blink-section" aria-label="捕捉操作">
          <h3>捕捉操作</h3><label className="blink-config-label" htmlFor="blink-config">编辑配置</label>
          <div className="blink-config-row">
            <div className="blink-config-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setConfigsOpen(false); }}>
              <div className="blink-config-field"><input id="blink-config" aria-label="眨眼配置名称" role="combobox" aria-haspopup="listbox" aria-expanded={configsOpen} aria-controls={configsOpen ? 'blink-config-options' : undefined} autoComplete="off" placeholder="输入配置名称" maxLength={40} value={config.name} disabled={locked} onChange={event => update({ name: event.target.value })} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setConfigsOpen(true); } else if (event.key === 'Escape') setConfigsOpen(false); }} />
                <button className="blink-config-toggle" type="button" aria-label="展开眨眼配置" aria-expanded={configsOpen} disabled={locked} onClick={() => setConfigsOpen(open => !open)}><ChevronDown size={13} /></button></div>
              {configsOpen && <div id="blink-config-options" className="blink-config-options" role="listbox" aria-label="已保存的眨眼配置">{blink.configs.length ? blink.configs.map(saved => <button key={saved.name} type="button" role="option" aria-selected={saved.name === config.name} onClick={() => { setConfig({ ...saved }); setConfigsOpen(false); }}>{saved.name}</button>) : <span>暂无已保存配置</span>}</div>}
            </div>
            <button className="button" type="button" disabled={locked || !window.desktop?.blink} onClick={() => void blink.importConfig()}><FolderOpen size={13} />浏览</button>
            <button className="button" type="button" aria-label="新增配置" disabled={locked} onClick={() => { setConfig({ ...newBlinkConfig(), name: '' }); setConfigsOpen(false); blink.setNotice('已新增空白配置，请输入名称后保存。'); }}><Plus size={13} />新增</button>
            <button className="button" type="button" aria-label="保存配置" disabled={locked} onClick={blink.save}><Save size={13} />保存</button>
          </div>
          <div className="blink-capture-actions">{actionButton('recover', '捕捉 Seed', true)}{actionButton('munchlax', 'TID/SID 测种', true)}{actionButton('reidentify', '校正')}<button className="button" title="捕获或校正成功后可切换 Timeline" disabled={state.status !== 'tracking' || state.mode === 'munchlax'} onClick={() => void blink.timeline()}><Clock3 size={14} />Timeline</button></div>
          {message && <p className="blink-action-message" role={messageError ? 'alert' : 'status'}>{message}</p>}
        </section>
        <section className="blink-section" aria-label="识别参数"><h3>识别参数</h3>
          <div className="blink-region-actions"><button className="button" title="点击后在右上角视频中右键拖动框选" disabled={locked || video.status !== 'connected'} onClick={() => void blink.beginSelection('roi')}>框选眼睛区域</button><button className="button" title="点击后在右上角视频中右键拖动框选" disabled={locked || video.status !== 'connected'} onClick={() => void blink.beginSelection('eye')}>截取眼睛</button></div>
        </section>
        <section className="blink-section blink-advanced" aria-label="高级时序"><h3>高级时序<span>8 项参数</span></h3><div className="blink-form-fields">
          {timingFields.map(([key, label, aria, min, max, step, help]) => <label key={key} title={help}>{label}<span className="blink-unit-input"><input aria-label={aria} type="number" min={min} max={max} step={step} value={config[key]} disabled={locked} onChange={event => update({ [key]: Number(event.target.value) })} />{key === 'timeDelay' && <span>秒</span>}</span></label>)}
          <label className="blink-check"><input type="checkbox" checked={config.noisy} disabled={locked} onChange={event => update({ noisy: event.target.checked, ...(event.target.checked ? { pokemonNpc: 1 } : {}) })} />1 PK NPC 校正</label>
          <label className="blink-check" title="对应 Project_Xs 的 +1 on menu close"><input type="checkbox" checked={config.menuClose} disabled={locked} onChange={event => update({ menuClose: event.target.checked })} />关闭菜单 +1</label>
        </div></section>
      </div>
    </div>
  </section>;
}
