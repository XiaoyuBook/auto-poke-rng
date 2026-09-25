import { useState } from 'react';
import { Eye, Scan, Play, Square, Save, Clock3, FolderOpen, ChevronRight, ChevronDown, Plus } from 'lucide-react';
import { newBlinkConfig, type BlinkController } from '../blink';
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
  const unavailable = !ready || locked || !window.desktop?.blink;
  const count = config.mode === 'munchlax' ? 64 : config.mode === 'reidentify' ? config.noisy ? 20 : 7 : 40;
  const matchingCapture = state.mode === config.mode && state.target === count;
  const captured = matchingCapture ? state.captured : 0;
  const tracking = state.tracking;
  const hasSeed = config.seed.length === 4 && config.seed.every(word => /^[\da-f]{1,8}$/i.test(word)) && config.seed.some(word => !/^0+$/.test(word));
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
          <div className="blink-capture-actions"><button className="button primary" disabled={unavailable} onClick={() => void blink.run('recover')}><Play size={14} />捕捉 Seed</button><button className="button primary" disabled={unavailable} onClick={() => void blink.run('munchlax')}>TID/SID 测种</button><button className="button" title={!hasSeed ? '先捕捉 Seed 或选择已有配置，再进行校正' : undefined} disabled={unavailable} onClick={() => { if (!hasSeed) { blink.setNotice('请先捕捉 Seed 或选择已有配置，再进行校正。'); return; } void blink.run('reidentify'); }}>校正</button><button className="button" title="捕获或校正成功后可切换 Timeline" disabled={state.status !== 'tracking' || state.mode === 'munchlax'} onClick={() => void blink.timeline()}><Clock3 size={14} />Timeline</button></div>
        </section>
        <section className="blink-section" aria-label="识别参数"><h3>识别参数</h3>
          <div className="blink-region-actions"><button className="button" title="点击后在右上角视频中右键拖动框选" disabled={locked || video.status !== 'connected'} onClick={() => void blink.beginSelection('roi')}>框选眼睛区域</button><button className="button" title="点击后在右上角视频中右键拖动框选" disabled={locked || video.status !== 'connected'} onClick={() => void blink.beginSelection('eye')}>截取眼睛</button></div>
        </section>
        <details className="blink-disclosure blink-advanced"><summary><ChevronRight size={13} />高级时序<span>8 项参数</span></summary><div className="blink-form-fields">
          <label className="blink-check"><input type="checkbox" checked={config.noisy} disabled={locked} onChange={event => update({ noisy: event.target.checked, ...(event.target.checked ? { pokemonNpc: 1 } : {}) })} />1 PK NPC 校正</label>
          {timingFields.map(([key, label, aria, min, max, step, help]) => <label key={key} title={help}>{label}<span className="blink-unit-input"><input aria-label={aria} type="number" min={min} max={max} step={step} value={config[key]} disabled={locked} onChange={event => update({ [key]: Number(event.target.value) })} />{key === 'timeDelay' && <span>秒</span>}</span></label>)}
          <label className="blink-check" title="对应 Project_Xs 的 +1 on menu close"><input type="checkbox" checked={config.menuClose} disabled={locked} onChange={event => update({ menuClose: event.target.checked })} />关闭菜单 +1</label>
        </div></details>
      </div>
    </div>
    <footer className="blink-footer"><div className="blink-run-actions"><button className="button" disabled={unavailable} onClick={() => void blink.run('preview')}><Scan size={14} />识别预览</button><button className="button" disabled={!busy || state.status === 'stopping'} onClick={() => void blink.stop()}><Square size={13} />停止</button><span>{busy && tracking ? `当前 ${tracking.advances.toLocaleString()} 帧` : busy && state.mode !== 'preview' ? `${captured} / ${count}` : config.sourceWidth ? `${config.sourceWidth} × ${config.sourceHeight}` : ''}</span></div><p role={state.status === 'error' ? 'alert' : 'status'}>{blink.notice || (video.status !== 'connected' && !busy ? '请先连接视频源，再在右侧画面框选。' : state.message)}</p></footer>
  </section>;
}
