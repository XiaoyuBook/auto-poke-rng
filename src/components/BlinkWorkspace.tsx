import { Eye, Scan, Play, Square, Save, Clock3, FolderOpen, ChevronRight } from 'lucide-react';
import type { BlinkController } from '../blink';
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
  return <section className="blink-workspace" aria-label="眨眼捕获工作区">
    <header className="blink-heading"><Eye size={18} /><h2>眨眼捕获</h2><span>Project_Xs</span></header>
    <div className="blink-scroll">
      <div className="blink-form">
        <section className="blink-section" aria-label="捕捉操作">
          <h3>捕捉操作</h3><label className="blink-config-label" htmlFor="blink-config">编辑配置</label>
          <div className="blink-config-row"><select id="blink-config" aria-label="眨眼配置" value={blink.configs.some(item => item.name === config.name) ? config.name : ''} disabled={locked} onChange={event => { const saved = blink.configs.find(item => item.name === event.target.value); if (saved) setConfig({ ...saved }); }}>
            <option value="">{config.name || '未命名'} · 未保存</option>{blink.configs.map(item => <option key={item.name}>{item.name}</option>)}</select>
            <button className="button" disabled={locked || !window.desktop?.blink} onClick={() => void blink.importConfig()}><FolderOpen size={13} />浏览</button></div>
          <div className="blink-capture-actions"><button className="button primary" disabled={unavailable} onClick={() => void blink.run('recover')}><Play size={14} />捕捉 Seed</button><button className="button primary" disabled={unavailable} onClick={() => void blink.run('munchlax')}>TID/SID 测种</button><button className="button" disabled={unavailable} onClick={() => void blink.run('reidentify')}>校正</button><button className="button" title="捕获或校正成功后可切换 Timeline" disabled={state.status !== 'tracking' || state.mode === 'munchlax'} onClick={() => void blink.timeline()}><Clock3 size={14} />Timeline</button></div>
        </section>
        <section className="blink-section" aria-label="识别参数"><h3>识别参数</h3>
          <div className="blink-region-actions"><button className="button" title="点击后在右上角视频中右键拖动框选" disabled={locked || video.status !== 'connected'} onClick={() => void blink.beginSelection('roi')}>框选眼睛区域</button><button className="button" title="点击后在右上角视频中右键拖动框选" disabled={locked || video.status !== 'connected'} onClick={() => void blink.beginSelection('eye')}>截取眼睛</button></div>
        </section>
        <details className="blink-disclosure blink-advanced"><summary><ChevronRight size={13} />高级时序<span>8 项参数</span></summary><div className="blink-form-fields">
          <label className="blink-check"><input type="checkbox" checked={config.noisy} disabled={locked} onChange={event => update({ noisy: event.target.checked, ...(event.target.checked ? { pokemonNpc: 1 } : {}) })} />1 PK NPC 校正</label>
          {timingFields.map(([key, label, aria, min, max, step, help]) => <label key={key} title={help}>{label}<span className="blink-unit-input"><input aria-label={aria} type="number" min={min} max={max} step={step} value={config[key]} disabled={locked} onChange={event => update({ [key]: Number(event.target.value) })} />{key === 'timeDelay' && <span>秒</span>}</span></label>)}
          <label className="blink-check" title="对应 Project_Xs 的 +1 on menu close"><input type="checkbox" checked={config.menuClose} disabled={locked} onChange={event => update({ menuClose: event.target.checked })} />关闭菜单 +1</label>
        </div></details>
        <details className="blink-disclosure"><summary><ChevronRight size={13} />校正范围与初始 Seed</summary><div className="blink-seeds">{config.seed.map((word, index) => <label key={index}>S[{index}]<input aria-label={`眨眼 S[${index}]`} spellCheck={false} maxLength={8} value={word} disabled={locked} onChange={event => update({ seed: config.seed.map((item, i) => i === index ? event.target.value.toUpperCase() : item) })} /></label>)}</div>
          <div className="blink-search"><label>搜索起点<input aria-label="眨眼搜索起点" type="number" min="0" max="999999" value={config.searchMin} disabled={locked} onChange={event => update({ searchMin: Number(event.target.value) })} /></label><label>搜索终点<input aria-label="眨眼搜索终点" type="number" min="1" max="1000000" value={config.searchMax} disabled={locked} onChange={event => update({ searchMax: Number(event.target.value) })} /></label></div>
          {config.noisy && config.searchMax - config.searchMin > 100000 && <p className="blink-hint">原版建议 1 PK NPC 搜索跨度不超过 100,000；更大范围可能出现不准确的匹配。</p>}
        </details>
        <div className="blink-save-row"><input aria-label="眨眼配置名称" placeholder="配置名称" maxLength={40} value={config.name} disabled={locked} onChange={event => update({ name: event.target.value })} /><button className="button" disabled={locked} onClick={blink.save}><Save size={13} />保存配置</button></div>
      </div>
    </div>
    <footer className="blink-footer"><div className="blink-run-actions"><button className="button" disabled={unavailable} onClick={() => void blink.run('preview')}><Scan size={14} />识别预览</button><button className="button" disabled={!busy || state.status === 'stopping'} onClick={() => void blink.stop()}><Square size={13} />停止</button><span>{busy && tracking ? `当前 ${tracking.advances.toLocaleString()} 帧` : busy && state.mode !== 'preview' ? `${captured} / ${count}` : config.sourceWidth ? `${config.sourceWidth} × ${config.sourceHeight}` : ''}</span></div><p role={state.status === 'error' ? 'alert' : 'status'}>{blink.notice || (video.status !== 'connected' && !busy ? '请先连接视频源，再在右侧画面框选。' : state.message)}</p></footer>
  </section>;
}
