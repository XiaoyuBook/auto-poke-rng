import { useEffect, useId, useState } from 'react';
import type { FrlgRunOptions } from '../frlgExecution';

function ExpansionInput({ value, onChange }: { value?: number[]; onChange: (value?: number[]) => void }) {
  const serialized = value?.join(',') || '';
  const [text, setText] = useState(serialized);
  useEffect(() => setText(serialized), [serialized]);
  return <input value={text} placeholder="留空或三个整数，以逗号分隔" onChange={event => setText(event.target.value)}
    onBlur={() => onChange(text.trim() ? text.split(/[,，]/).map(Number) : undefined)} />;
}

function RunToggle({ label, accessibleLabel = label, description, checked, onChange }: {
  label: string; accessibleLabel?: string; description?: string; checked: boolean; onChange: (checked: boolean) => void;
}) {
  const descriptionId = useId();
  return <label className="frlg-run-toggle">
    <span>{label}{description && <small id={descriptionId}>{description}</small>}</span>
    <input type="checkbox" role="switch" aria-label={accessibleLabel} aria-describedby={description ? descriptionId : undefined}
      checked={checked} onChange={event => onChange(event.target.checked)} />
  </label>;
}

export function FrlgRunSettings({ options, onChange, locked, wild }: {
  options: FrlgRunOptions; onChange: (options: FrlgRunOptions) => void; locked: boolean; wild: boolean;
}) {
  const update = (key: keyof FrlgRunOptions, value: unknown) => onChange({ ...options, [key]: value });
  const groupId = useId();
  return <section className="automation-card automation-feature-card frlg-run-settings" aria-label="火叶运行设置">
    <div className="automation-feature-heading"><strong>运行与反查校准</strong><span>设置随当前存档保存</span></div>
    <fieldset disabled={locked} className="automation-feature-body frlg-run-settings-body">
      <p className="frlg-run-preparation">使用 1920×1080 原始画面。<br />运行前按脚本包说明准备存档起点、队伍、道具和游戏设置；具体要求见运行日志。</p>
      <div className="frlg-run-groups">
        <section className="frlg-run-group" aria-labelledby={`${groupId}-capture`}>
          <h3 id={`${groupId}-capture`}>捕获与出闪</h3>
          <RunToggle label="成功后自动完成图鉴" description="确认目标出闪或完整命中且流程正常结束后，标记本次存档的图鉴" checked={options.auto_complete_pokedex ?? false} onChange={value => update('auto_complete_pokedex', value)} />
          <label className="frlg-run-select-row"><span>脚本入口</span><select aria-label="脚本入口" value={options.entry ?? 'formal'} onChange={event => update('entry', event.target.value)}><option value="formal">正式入口（默认）</option><option value="timeline">时间轴入口</option></select></label>
          <RunToggle label="使用麻痹" checked={options.paralysis ?? false} onChange={value => update('paralysis', value)} />
          <RunToggle label="使用点到为止" checked={options.false_swipe ?? false} onChange={value => update('false_swipe', value)} />
          <RunToggle label="出闪后继续抓捕" checked={options.continue_capture_after_shiny ?? false} onChange={value => update('continue_capture_after_shiny', value)} />
          <RunToggle label="保存 Switch 录像" accessibleLabel="出闪后保存 Switch 录像" description="遇到闪光时保存录像" checked={options.record_shiny_video ?? false} onChange={value => update('record_shiny_video', value)} />
          {wild && <>
            <RunToggle label="非目标闪光时停止" accessibleLabel="遇到非目标闪光时停止" checked={options.stop_on_non_target_shiny ?? true} onChange={value => update('stop_on_non_target_shiny', value)} />
            <RunToggle label="野生携带道具模式" checked={options.item_rng_mode ?? false} onChange={value => update('item_rng_mode', value)} />
            {options.item_rng_mode && <label className="frlg-run-select-row frlg-run-dependent"><span>队伍空位</span><input aria-label="队伍空位" type="number" min={1} max={5} value={options.party_empty_slots ?? 1} onChange={event => update('party_empty_slots', Number(event.target.value))} /></label>}
          </>}
        </section>
        <section className="frlg-run-group" aria-labelledby={`${groupId}-seed`}>
          <h3 id={`${groupId}-seed`}>Seed 与校准</h3>
          <label className="frlg-run-select-row"><span>Seed 启动方案</span><select aria-label="Seed 启动方案" value={options.seed_startup_scheme ?? 0} onChange={event => update('seed_startup_scheme', Number(event.target.value))}><option value={0}>HOME_BUFFER</option><option value={1}>固定用户选择</option></select></label>
          <label className="frlg-run-select-row"><span>Seed 校准方案</span><select aria-label="Seed 校准方案" value={options.seed_calibration_scheme ?? 0} onChange={event => update('seed_calibration_scheme', Number(event.target.value))}><option value={0}>方案 1</option><option value={1}>方案 2</option></select></label>
          <RunToggle label="HOME 自适应阈值" accessibleLabel="HOME 画面自适应阈值" description="适应 HOME 画面的亮度变化" checked={options.home_buffer_adaptive_threshold ?? false} onChange={value => update('home_buffer_adaptive_threshold', value)} />
          <RunToggle label="复用成功预校准" accessibleLabel="保存并复用当前存档的成功预校准" description="目标出闪或完整命中，上下文一致且正常结束后保存" checked={options.update_precalibration ?? false} onChange={value => update('update_precalibration', value)} />
          <p className="frlg-run-lock-note">{locked ? '当前流程进行中，设置暂不可修改。' : '运行期间设置锁定'}</p>
        </section>
      </div>
      <details className="automation-subsection frlg-run-advanced"><summary><strong>高级反查与校准参数</strong><span>输出 · 反查范围 · 预校准</span></summary>
        <section className="frlg-run-advanced-group" aria-label="输出与修正设置">
          <h4>输出与修正</h4>
          <p>默认使用精简 ECS 输出。需要排查脚本时再切换完整调试。</p>
          <div className="automation-fields frlg-run-advanced-fields">
            <label>ECS 输出<select value={options.debug_log_output ?? 0} onChange={event => update('debug_log_output', Number(event.target.value))}><option value={0}>精简</option><option value={1}>完整调试</option></select></label>
            <label>帧奇偶修正方案<select value={options.frame_parity_scheme ?? 1} onChange={event => update('frame_parity_scheme', Number(event.target.value))}><option value={0}>方案 0</option><option value={1}>方案 1</option></select></label>
          </div>
        </section>
        <section className="frlg-run-advanced-group" aria-label="反查范围设置">
          <h4>反查范围</h4>
          <p>扩窗覆盖需同时填写层数和两组三层数值；留空使用原版默认。</p>
          <div className="automation-fields frlg-run-advanced-fields">
            <label>反查扩窗层数<input type="number" min={0} max={3} value={options.reverse_expansion_layers ?? ''} placeholder="原版默认" onChange={event => update('reverse_expansion_layers', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
            <label>波克比 Seed 反查帧半宽<input type="number" min={0} value={options.togepi_seed_reverse_frame_half_width ?? ''} placeholder="原版默认" onChange={event => update('togepi_seed_reverse_frame_half_width', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
            {(['reverse_expansion_seed_tolerances', 'reverse_expansion_frame_half_widths'] as const).map(key => <label key={key}>{key.includes('seed') ? '三层 Seed 容差' : '三层帧半宽'}<ExpansionInput value={options[key]} onChange={value => update(key, value)} /></label>)}
          </div>
        </section>
        <section className="frlg-run-advanced-group" aria-label="预校准覆盖设置">
          <h4>预校准覆盖</h4>
          <div className="automation-fields frlg-run-advanced-fields">
            {(['precalibration_seed_ns1', 'precalibration_seed_ns2', 'precalibration_frame_ns1', 'precalibration_frame_ns2'] as const).map((key, index) => <label key={key}>{['Switch 1 Seed 预校准', 'Switch 2 Seed 预校准', 'Switch 1 帧预校准', 'Switch 2 帧预校准'][index]}<input type="number" value={options[key] ?? ''} placeholder="原版默认" onChange={event => update(key, event.target.value === '' ? undefined : Number(event.target.value))} /></label>)}
          </div>
        </section>
      </details>
    </fieldset>
  </section>;
}
