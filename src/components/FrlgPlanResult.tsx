import type { ReactNode } from 'react';
import { getFrlgLocationLabel, getFrlgSpeciesLabel, type FrlgPlannerResult } from '../frlgAutomation';
import { FRLG_ABILITY_LABELS, FRLG_NATURE_LABELS, FRLG_TYPE_LABELS, FRLG_SOUND_LABELS, FRLG_BTN_MODE_LABELS, FRLG_SEED_BTN_LABELS, FRLG_EXTRA_BTN_LABELS } from '../frlgMetadata';
import { Dialog } from './Dialog';
import { FrlgSprite } from './FrlgSprite';

const label = (table: Record<string, string>, value: string) => table[value] || value;
const genderLabel = (value: string) => label({ M: '雄性', F: '雌性', '-': '无性别' }, value);
const shinyLabel = (value: string) => label({ None: '非闪光', Star: '星形闪光', Square: '方形闪光' }, value);
const ivText = (plan: FrlgPlannerResult) => {
  const { hp, attack, defense, sp_attack, sp_defense, speed } = plan.target.ivs;
  return [hp, attack, defense, sp_attack, sp_defense, speed].join(' / ');
};
const uncalculated = '指定模式未计算';
function Metric({ title, children }: { title: string; children: ReactNode }) {
  return <div><dt>{title}</dt><dd>{children}</dd></div>;
}

export function FrlgPlanSummary({ plan, onDetails }: { plan: FrlgPlannerResult; onDetails: () => void }) {
  const { request, target, initial_seed, route_support } = plan;
  const direct = request.direct_mode;
  const shiny = !direct && ['Star', 'Square'].includes(target.shiny);
  return <section className="frlg-recommendation-card" aria-label="火叶推荐方案">
    <header className="frlg-recommendation-heading">
      <div><h3>推荐方案</h3><p>{direct ? '使用指定 Seed 与消耗帧' : '按个体合计最高、可达 Advance 最小选择'}</p></div>
      <span className="frlg-plan-badge">{route_support.can_start ? '规划完成' : '路线未覆盖'}</span>
    </header>
    <div className="frlg-recommendation-main">
      <span className="frlg-recommendation-emblem"><FrlgSprite species={target.pokemon} shiny={shiny} /></span>
      <div className="frlg-recommendation-identity">
        <strong>{shiny ? '闪光' : ''}{getFrlgSpeciesLabel(target.pokemon)}</strong>
        <small>{request.location ? getFrlgLocationLabel(request.location) : '定点目标'}{!direct && target.level > 0 ? ` · LV ${target.level}` : ''}</small>
        <small>{target.method}{!direct ? ` · ${shinyLabel(target.shiny)}` : ' · 指定参数'}</small>
      </div>
    </div>
    <div className="frlg-recommendation-metrics">
      <div><strong>{initial_seed.seed}</strong><span>Seed</span></div>
      <div><strong>{initial_seed.advances.toLocaleString('en-US')}</strong><span>Advance</span></div>
      <div><strong>{direct ? '—' : plan.selection.iv_total}</strong><span>个体合计</span></div>
    </div>
    {direct ? <p className="frlg-recommendation-ivs">指定模式不计算个体与闪光结果；Seed 模式 {plan.execution.seed_mode}，启动等待 {initial_seed.seed_time.toLocaleString('en-US')} ms。</p> : <>
      <p className="frlg-recommendation-ivs">IV {ivText(plan)}</p>
      <p className="frlg-recommendation-attributes">{label(FRLG_NATURE_LABELS, target.nature)} · {label(FRLG_ABILITY_LABELS, target.ability)} · {genderLabel(target.gender)}</p>
    </>}
    <button type="button" className="frlg-recommendation-detail" onClick={onDetails}>查看方案详情</button>
  </section>;
}

export function FrlgPlanDetails({ plan, close }: { plan: FrlgPlannerResult; close: () => void }) {
  const { request, target, initial_seed, execution, route_support, search_summary } = plan;
  const direct = request.direct_mode;
  const settings = execution.game_settings;
  return <Dialog title="火叶推荐方案详情" close={close} className="automation-target-dialog frlg-target-dialog">
    <div className="automation-target-dialog-body frlg-result-body">
      <section className="frlg-dialog-section"><h3>具体目标</h3><dl className="automation-metrics">
        <Metric title="宝可梦">{getFrlgSpeciesLabel(target.pokemon)}</Metric>
        <Metric title="地点">{request.location ? getFrlgLocationLabel(request.location) : '定点目标'}</Metric>
        <Metric title="等级">{direct ? uncalculated : target.level > 0 ? target.level : '定点目标'}</Metric>
        <Metric title="PID">{direct ? uncalculated : target.pid}</Metric>
        <Metric title="闪光">{direct ? uncalculated : shinyLabel(target.shiny)}</Metric>
        <Metric title="性格">{direct ? uncalculated : label(FRLG_NATURE_LABELS, target.nature)}</Metric>
        <Metric title="特性">{direct ? uncalculated : label(FRLG_ABILITY_LABELS, target.ability)}</Metric>
        <Metric title="性别">{direct ? uncalculated : genderLabel(target.gender)}</Metric>
        <Metric title="隐藏力量">{direct ? uncalculated : `${label(FRLG_TYPE_LABELS, target.hidden_type)} · ${target.hidden_power}`}</Metric>
        <Metric title="IV（HP / 攻 / 防 / 特攻 / 特防 / 速）">{direct ? uncalculated : ivText(plan)}</Metric>
        <Metric title="个体合计">{direct ? uncalculated : plan.selection.iv_total}</Metric>
        <Metric title="搜索方法">{target.method}</Metric>
      </dl></section>
      <section className="frlg-dialog-section"><h3>执行参数</h3><dl className="automation-metrics">
        <Metric title="ROM">{request.game.startsWith('fr') ? '火红' : '叶绿'} · {request.game.includes('_jpn_') ? '日版（日文）' : '美版（英文）'} · {request.game.endsWith('nx2') ? 'Switch 2' : 'Switch 1'}</Metric>
        <Metric title="训练家">TID {request.tid} / SID {request.sid}</Metric>
        <Metric title="目标 Seed">{direct ? uncalculated : target.target_seed}</Metric>
        <Metric title="初始 Seed">{initial_seed.seed}</Metric>
        <Metric title="Advance">{initial_seed.advances.toLocaleString('en-US')}</Metric>
        <Metric title="Seed 模式">{execution.seed_mode}</Metric>
        <Metric title="启动等待">{initial_seed.seed_time.toLocaleString('en-US')} ms</Metric>
        <Metric title="总等待">{initial_seed.total_time}</Metric>
        <Metric title="SOUND">{label(FRLG_SOUND_LABELS, settings.sound)} ({settings.sound})</Metric>
        <Metric title="BUTTON MODE">{label(FRLG_BTN_MODE_LABELS, settings.button_mode)} ({settings.button_mode})</Metric>
        <Metric title="Seed 按键">{label(FRLG_SEED_BTN_LABELS, settings.seed_button)}</Metric>
        <Metric title="额外按键">{label(FRLG_EXTRA_BTN_LABELS, settings.extra_button)}</Metric>
        <Metric title="路线状态">{route_support.summary}</Metric>
        <Metric title="脚本状态">尚未生成运行脚本；未执行设备与脚本预检。</Metric>
      </dl></section>
      {plan.warnings.length > 0 && <section className="frlg-dialog-section"><h3>运行提示</h3><ul className="frlg-warnings">{plan.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></section>}
    </div>
    <div className="automation-target-dialog-actions"><span className="muted">匹配 {search_summary.matching_outcomes} · 可达 {search_summary.reachable_outcomes} · 路线 {search_summary.feasible_routes}</span><button type="button" className="button primary" onClick={close}>关闭</button></div>
  </Dialog>;
}
