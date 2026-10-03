import { useEffect, useState } from 'react';
import type { FrlgRunOptions } from '../frlgExecution';

function ExpansionInput({ value, onChange }: { value?: number[]; onChange: (value?: number[]) => void }) {
  const serialized = value?.join(',') || '';
  const [text, setText] = useState(serialized);
  useEffect(() => setText(serialized), [serialized]);
  return <input value={text} placeholder="留空或三个整数，以逗号分隔" onChange={event => setText(event.target.value)}
    onBlur={() => onChange(text.trim() ? text.split(/[,，]/).map(Number) : undefined)} />;
}

export function FrlgRunSettings({ options, onChange, locked, wild }: {
  options: FrlgRunOptions; onChange: (options: FrlgRunOptions) => void; locked: boolean; wild: boolean;
}) {
  const update = (key: keyof FrlgRunOptions, value: unknown) => onChange({ ...options, [key]: value });
  const flags = [
    ['paralysis', '使用麻痹', false], ['false_swipe', '使用点到为止', false],
    ['continue_capture_after_shiny', '出闪后继续抓捕', false],
    ['record_shiny_video', '出闪后保存 Switch 录像', false],
    ['stop_on_non_target_shiny', '遇到非目标闪光时停止', true],
    ['home_buffer_adaptive_threshold', 'HOME 画面自适应阈值', false],
    ['update_precalibration', '保存并复用当前存档的成功预校准', false],
  ] as const;
  return <section className="automation-card automation-feature-card" aria-label="火叶运行设置">
    <div className="automation-feature-heading"><strong>运行与反查校准</strong><span>设置随当前存档保存</span></div>
    <fieldset disabled={locked} className="automation-feature-body">
      <p className="muted">视频源使用 1920×1080 原始画面。运行前按脚本包说明准备存档起点、队伍、道具和游戏设置；启动后可在日志查看本目标的具体要求。</p>
      <div className="automation-fields frlg-base-fields">
        <label>脚本入口<select value={options.entry ?? 'formal'} onChange={event => update('entry', event.target.value)}><option value="formal">正式入口（默认）</option><option value="timeline">时间轴入口</option></select></label>
        {flags.filter(([key]) => wild || key !== 'stop_on_non_target_shiny').map(([key, label, fallback]) => <label key={key} className="frlg-checkbox-field"><span>{label}</span><input type="checkbox" checked={options[key] ?? fallback} onChange={event => update(key, event.target.checked)} /></label>)}
        {wild && <label className="frlg-checkbox-field"><span>野生携带道具模式</span><input type="checkbox" checked={options.item_rng_mode ?? false} onChange={event => update('item_rng_mode', event.target.checked)} /></label>}
        {wild && options.item_rng_mode && <label>队伍空位<input type="number" min={1} max={5} value={options.party_empty_slots ?? 1} onChange={event => update('party_empty_slots', Number(event.target.value))} /></label>}
        <label>Seed 启动方案<select value={options.seed_startup_scheme ?? 0} onChange={event => update('seed_startup_scheme', Number(event.target.value))}><option value={0}>HOME_BUFFER</option><option value={1}>固定用户选择</option></select></label>
        <label>Seed 校准方案<select value={options.seed_calibration_scheme ?? 0} onChange={event => update('seed_calibration_scheme', Number(event.target.value))}><option value={0}>方案 1</option><option value={1}>方案 2</option></select></label>
      </div>
      <details className="automation-subsection"><summary>高级反查与校准参数</summary>
        <p className="muted">默认使用精简 ECS 输出，只保留阶段、结果和异常。需要排查脚本时再切换完整调试；扩窗覆盖需同时填写层数和两组三层数值。只有完整命中、上下文一致且正常结束时，才更新该存档的预校准。</p>
        <div className="automation-fields frlg-base-fields">
          <label>ECS 输出<select value={options.debug_log_output ?? 0} onChange={event => update('debug_log_output', Number(event.target.value))}><option value={0}>精简</option><option value={1}>完整调试</option></select></label>
          <label>帧奇偶修正方案<select value={options.frame_parity_scheme ?? 1} onChange={event => update('frame_parity_scheme', Number(event.target.value))}><option value={0}>方案 0</option><option value={1}>方案 1</option></select></label>
          <label>反查扩窗层数<input type="number" min={0} max={3} value={options.reverse_expansion_layers ?? ''} placeholder="原版默认" onChange={event => update('reverse_expansion_layers', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
          {(['reverse_expansion_seed_tolerances', 'reverse_expansion_frame_half_widths'] as const).map(key => <label key={key}>{key.includes('seed') ? '三层 Seed 容差' : '三层帧半宽'}<ExpansionInput value={options[key]} onChange={value => update(key, value)} /></label>)}
          <label>波克比 Seed 反查帧半宽<input type="number" min={0} value={options.togepi_seed_reverse_frame_half_width ?? ''} placeholder="原版默认" onChange={event => update('togepi_seed_reverse_frame_half_width', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
          {(['precalibration_seed_ns1', 'precalibration_seed_ns2', 'precalibration_frame_ns1', 'precalibration_frame_ns2'] as const).map((key, index) => <label key={key}>{['Switch 1 Seed 预校准', 'Switch 2 Seed 预校准', 'Switch 1 帧预校准', 'Switch 2 帧预校准'][index]}<input type="number" value={options[key] ?? ''} placeholder="原版默认" onChange={event => update(key, event.target.value === '' ? undefined : Number(event.target.value))} /></label>)}
        </div>
      </details>
    </fieldset>
  </section>;
}
