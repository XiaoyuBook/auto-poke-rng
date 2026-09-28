import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { AutomationFlow, AutomationRun, AutomationSnapshot, FlowNode } from '../automation';
import { Dialog } from './Dialog';

const nodes: FlowNode[] = ['seed', 'search', 'advance', 'calibrate', 'wait', 'hit', 'result'];
const names: Record<FlowNode, string> = {
  seed: '测种', search: '搜索', advance: '过帧', calibrate: '校正', wait: '等待', hit: '撞帧判闪', result: '结果',
};
const edges: [FlowNode, FlowNode][] = [
  ['seed', 'search'], ['search', 'advance'], ['advance', 'calibrate'], ['calibrate', 'search'],
  ['calibrate', 'wait'], ['search', 'wait'], ['wait', 'hit'], ['hit', 'result'],
  ['advance', 'seed'], ['calibrate', 'advance'],
];
type State = AutomationSnapshot['state'];
type Metric = { label: string; value: string; unit?: string };

export function deriveStaticFlowView(state: State | null, run?: AutomationRun, otherBusy = false) {
  const status = state?.status || 'idle';
  const progress = state?.progress;
  const flow = state && state.flow?.runId === state.runId ? state.flow : null;
  const capture = state && state.capture?.activityId === progress?.activity_id ? state.capture : null;
  const shiny = progress?.phase === '运行撞闪脚本' ? state?.shiny : null;
  const activity = state && state.activity?.activityId === progress?.activity_id ? state.activity : null;
  const active = status === 'running' && !!flow && !!progress;
  const round = flow?.roundIndex || 0;
  const roundLabel = round > 0 ? flow?.context.loopMode === 'count' ? `第 ${round} / ${flow.context.loopCount} 轮`
    : flow?.context.loopMode === 'infinite' ? `第 ${round} 轮 · 无限` : `第 ${round} 轮` : '';
  let title = otherBusy ? '其他自动流程运行中' : '等待开始';
  let description = otherBusy ? '当前自动定点尚未运行' : '可先运行开始前检查';
  let label = otherBusy ? '占用中' : '待命';
  let metric: Metric | null = null;

  if (state) {
    if (status === 'starting') { title = state.runId ? '正在检查运行条件' : '正在准备判闪校准'; description = '启动前正在检查设备与配置'; label = '启动中'; }
    else if (status === 'stopping') { title = '正在停止并释放设备'; description = '保留最后运行位置'; label = '停止中'; }
    else if (status === 'stopped') { title = '流程已停止'; description = state.message || '已停止自动流程'; label = '已停止'; }
    else if (status === 'failed') {
      const unknown = progress?.result_kind === 'unknown';
      title = unknown ? '判闪结果未知，需人工确认' : '流程运行失败';
      description = unknown ? '请人工确认当前战斗' : state.message || '可在运行详情中查看原因';
      label = unknown ? '需要确认' : '失败';
    } else if (status === 'completed') {
      if (!state.runId) { title = '判闪校准完成'; description = state.message; label = '已完成'; }
      else if (progress?.result_kind === 'shiny') {
        title = progress.recording_status === 'failed' ? '已出闪，录像失败' : '已出闪，流程结束';
        description = progress.recording_status === 'saved' ? '自动录像已保存' : progress.recording_status === 'failed' ? '录像失败详情见日志' : '本次运行已结束';
        label = '已出闪';
        const interval = run?.rounds.at(-1)?.interval;
        if (typeof interval === 'number') metric = { label: '判闪间隔', value: interval.toFixed(3), unit: '秒' };
      } else {
        title = progress?.result_kind === 'no_candidates' ? '搜索范围内无候选' : progress?.result_kind === 'unknown' ? '判闪结果未知，本轮已结束' : '本次运行已完成';
        description = progress?.result_kind === 'unknown' ? '已按当前策略结束运行' : '流程已正常结束';
        label = '已完成';
      }
    } else if (status === 'running' && progress) {
      label = '运行中';
      switch (progress.phase) {
        case '运行测种脚本': title = '正在执行测种脚本'; description = '脚本完成后将捕获 Seed'; break;
        case '捕获Seed':
          title = capture?.stage === 'solving' ? '正在解算 Seed' : progress.activity_kind === 'recovery_capture' ? '正在补救测种' : '正在采集眨眼';
          description = capture?.stage === 'solving' ? '眨眼采集完成，正在解算位置' : progress.activity_kind === 'recovery_capture' ? '普通校正失败后，继续本轮测种' : '使用所选测种配置采集';
          if (capture && ['start', 'capturing'].includes(capture.stage || '')) metric = { label: '采集眨眼', value: `${capture.captured} / ${capture.target}` };
          break;
        case '搜索目标': title = '正在搜索可达候选'; description = '按当前筛选条件查找目标';
          if (flow?.context.maxAdvances != null) metric = { label: '搜索范围', value: flow.context.maxAdvances.toLocaleString(), unit: 'Adv' }; break;
        case '决策过帧': title = '正在判断下一步'; description = '根据目标与启动位置选择过帧或等待'; break;
        case '运行过帧脚本': title = '正在执行过帧脚本'; description = '脚本完成后按策略校正或重新测种';
          if (progress.requested_advances != null) metric = { label: '本次计划推进', value: progress.requested_advances.toLocaleString(), unit: 'Adv' }; break;
        case '校正位置':
          title = progress.activity_kind === 'escape_reidentify' ? '逃跑后正在校正' : '正在校正位置';
          description = '目标仍有效时可直接进入过帧或等待';
          if (capture?.stage === 'solving') title = '正在解算校正位置';
          if (capture && ['start', 'capturing'].includes(capture.stage || '')) metric = { label: '采集眨眼', value: `${capture.captured} / ${capture.target}` };
          break;
        case '运行过场脚本':
          title = capture ? capture.stage === 'solving' ? '过场后正在解算位置' : '过场后正在校正' : '正在执行过场脚本';
          description = '过场校正完成后继续搜索目标';
          if (capture && ['start', 'capturing'].includes(capture.stage || '')) metric = { label: '采集眨眼', value: `${capture.captured} / ${capture.target}` };
          break;
        case '最终校准': title = '正在校准启动时机'; description = '核对当前 Adv 与脚本启动 Adv'; break;
        case '等待触发': title = '等待启动撞帧脚本'; description = '到脚本启动 Adv 时自动执行';
          if (progress.remaining_to_trigger != null) metric = { label: '距启动还需', value: progress.remaining_to_trigger.toLocaleString(), unit: 'Adv' }; break;
        case '动态调整闪帧': title = '正在调整脚本等待'; description = '调整完成后执行撞帧脚本'; break;
        case '运行撞闪脚本':
          title = '撞帧中 · 正在检测闪光';
          description = shiny?.stage === 'first_seen' ? '已识别第一条提示，等待第二条' : shiny?.stage === 'unknown' ? '判闪超时，结果尚不确定' : shiny?.scriptStatus === 'done' ? '脚本已结束，等待判闪结果' : '撞帧脚本与判闪检测并行运行';
          if (progress.attempt_index) metric = { label: '本轮尝试', value: `第 ${progress.attempt_index} 次` };
          break;
        case '运行逃跑脚本': title = '正在逃跑续搜'; description = '逃跑后校正，继续本轮搜索';
          if (progress.attempt_index) metric = { label: '本轮尝试', value: `第 ${progress.attempt_index} 次` }; break;
        case '反查个体': title = activity?.stage === 'notes_ocr' ? '正在识别个体信息' : activity?.stage === 'matching' ? '正在匹配反查候选' : '正在反查个体';
          description = '找到的 delay 候选将存入历史样本'; break;
        case '循环检查': title = progress.activity_kind === 'recording' ? '已出闪，正在自动录像' : '正在处理本轮结果';
          description = progress.activity_kind === 'recording' ? '录像完成后结束流程' : '根据运行模式决定是否进入下一轮'; break;
        default: title = '流程运行中'; description = '正在等待下一条运行事件';
      }
    }
  }
  const transition = flow?.transition;
  if (status === 'running' && transition && transition.to === flow?.node && transition.from === 'calibrate' && transition.to === 'wait')
    description = '校正后目标仍有效，直接进入等待';
  else if (status === 'running' && transition && transition.to === flow?.node && transition.from === 'advance' && transition.to === 'seed')
    description = '过帧后进入测种，仍按真实轮次计数';
  return { title, description, label, metric, roundLabel, active, node: flow?.node || null,
    nextNode: active ? flow?.nextNode || null : null, flow };
}

function points(width: number) {
  return {
    seed: { x: width * .10, y: 72, labelY: 99 }, search: { x: width * .30, y: 30, labelY: 10 },
    advance: { x: width * .30, y: 112, labelY: 140 }, calibrate: { x: width * .52, y: 72, labelY: 99 },
    wait: { x: width * .70, y: 30, labelY: 10 }, hit: { x: width * .90, y: 72, labelY: 99 },
    result: { x: width * .70, y: 112, labelY: 140 },
  } satisfies Record<FlowNode, { x: number; y: number; labelY: number }>;
}

function pathBetween(from: FlowNode, to: FlowNode, width: number) {
  const p = points(width), a = p[from], b = p[to];
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.max(1, Math.hypot(dx, dy));
  const start = { x: a.x + dx / length * 10, y: a.y + dy / length * 10 };
  const end = { x: b.x - dx / length * 10, y: b.y - dy / length * 10 };
  if (from === 'result' && to === 'seed') return `M ${start.x} ${start.y} Q ${width * .37} 124 ${end.x} ${end.y}`;
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

export function StaticFlowStatusCard({ state, run, activeFlowId, otherBusy, details }: {
  state: State | null; run?: AutomationRun; activeFlowId: string; otherBusy: boolean; details: ReactNode;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [width, setWidth] = useState(440);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [recent, setRecent] = useState<AutomationFlow['transition']>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const routeRef = useRef<SVGPathElement>(null);
  const tailRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const haloRef = useRef<SVGCircleElement>(null);
  const gradientRef = useRef<SVGLinearGradientElement>(null);
  const seenRef = useRef(0);
  const id = useId().replaceAll(':', '_');
  const view = deriveStaticFlowView(state, run, otherBusy);
  const flow = view.flow;
  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(220, Math.round(entries[0].contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { seenRef.current = flow?.transitionSeq || 0; setRecent(null); }, [flow?.runId]);
  useEffect(() => {
    if (!flow || flow.transitionSeq === seenRef.current) return;
    seenRef.current = flow.transitionSeq;
    setRecent(flow.transition);
    const timer = window.setTimeout(() => setRecent(null), 900);
    return () => window.clearTimeout(timer);
  }, [flow?.transitionSeq, flow?.runId]);
  const route = view.active && view.node && view.nextNode
    ? { from: view.node, to: view.nextNode, mode: 'planned' as const, key: `p:${flow?.runId}:${flow?.activityId}:${view.node}:${view.nextNode}` }
    : view.active && recent
      ? { from: recent.from, to: recent.to, mode: 'arrived' as const, key: `a:${flow?.runId}:${recent.seq}` }
      : null;
  const routePath = route ? pathBetween(route.from, route.to, width) : '';
  useEffect(() => {
    const path = routeRef.current, tail = tailRef.current, dot = dotRef.current, halo = haloRef.current, gradient = gradientRef.current;
    if (!path || !tail || !dot || !halo || !gradient || !route || reducedMotion || typeof path.getTotalLength !== 'function') return;
    let frame = 0, started = 0;
    const total = path.getTotalLength();
    const draw = (now: number) => {
      if (!started) started = now;
      const elapsed = now - started;
      const fraction = route.mode === 'planned' ? (elapsed % 1600) / 1600 : Math.min(1, elapsed / 750);
      const end = path.getPointAtLength(total * fraction);
      const start = path.getPointAtLength(Math.max(0, total * fraction - 22));
      dot.setAttribute('cx', String(end.x)); dot.setAttribute('cy', String(end.y));
      halo.setAttribute('cx', String(end.x)); halo.setAttribute('cy', String(end.y));
      tail.setAttribute('d', `M ${start.x} ${start.y} L ${end.x} ${end.y}`);
      gradient.setAttribute('x1', String(start.x)); gradient.setAttribute('y1', String(start.y));
      gradient.setAttribute('x2', String(end.x === start.x ? end.x + .001 : end.x)); gradient.setAttribute('y2', String(end.y));
      if (route.mode === 'planned' || fraction < 1) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [route?.key, routePath, reducedMotion]);
  const p = points(width);
  const ownerChanged = !!flow?.context.flowId && flow.context.flowId !== activeFlowId;
  const nodeName = view.node ? names[view.node] : '尚未开始';
  const accessiblePath = view.nextNode ? `当前${nodeName}，预计下一步${names[view.nextNode]}` : `当前${nodeName}，下一步尚未确定`;
  return <section className="automation-flow-card" data-status={state?.status || 'idle'} data-running={view.active && !reducedMotion} aria-label="自动流程状态">
    <header className="automation-flow-header"><strong>流程状态</strong><div className="automation-flow-header-meta">
      {view.roundLabel && <span>{view.roundLabel}</span>}
      <span className="automation-flow-status">{view.label}</span>
      <button type="button" className="automation-flow-detail-button" aria-label="查看运行详情" title="查看运行详情" onClick={() => setDetailOpen(true)}>详情</button>
    </div></header>
    {ownerChanged && <p className="automation-flow-owner">上次运行：{flow?.context.flowName}</p>}
    <div className="automation-flow-map" ref={mapRef}>
      <svg viewBox={`0 0 ${width} 148`} role="img" aria-label={accessiblePath}>
        <defs>
          <radialGradient id={`${id}-glow`}><stop offset="0%" stopColor="#b5d0ff" stopOpacity=".8"/><stop offset="45%" stopColor="#9fbef4" stopOpacity=".2"/><stop offset="100%" stopColor="#8bb2ee" stopOpacity="0"/></radialGradient>
          <radialGradient id={`${id}-core`} cx="36%" cy="28%" r="80%"><stop offset="0%" stopColor="#e5f0ff"/><stop offset="48%" stopColor="#b4cdf8"/><stop offset="100%" stopColor="#819fcf"/></radialGradient>
          <linearGradient ref={gradientRef} id={`${id}-tail`} gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#b8d0ff" stopOpacity="0"/><stop offset="70%" stopColor="#c6dcff" stopOpacity=".8"/><stop offset="100%" stopColor="#f2f7ff"/></linearGradient>
        </defs>
        {edges.map(([from, to]) => <path key={`${from}-${to}`} className="automation-flow-edge" d={pathBetween(from, to, width)} />)}
        {route && <><path ref={routeRef} className="automation-flow-route" data-route={`${route.from}-${route.to}`} d={routePath}/>
          {!reducedMotion && <><path ref={tailRef} className="automation-flow-tail" stroke={`url(#${id}-tail)`}/><circle ref={haloRef} className="automation-flow-travel-glow" r="9"/><circle ref={dotRef} className="automation-flow-travel-dot" r="2.3"/></>}</>}
        {nodes.map(node => <g key={node} className="automation-flow-node" data-node={node} data-state={view.node === node ? 'current' : view.nextNode === node ? 'next' : 'idle'}>
          <circle className="automation-flow-node-glow" cx={p[node].x} cy={p[node].y} r="23" fill={`url(#${id}-glow)`}/>
          <circle className="automation-flow-node-ring" cx={p[node].x} cy={p[node].y} r="11.5"/>
          <circle className="automation-flow-node-core" cx={p[node].x} cy={p[node].y} r="6.5" fill={view.node === node ? `url(#${id}-core)` : undefined}/>
          <circle className="automation-flow-node-beacon" cx={p[node].x} cy={p[node].y} r="1.8"/>
          <text x={p[node].x} y={p[node].labelY}>{node === 'hit' && width < 380 ? <><tspan x={p[node].x} y="95">撞帧</tspan><tspan x={p[node].x} y="109">判闪</tspan></> : names[node]}</text>
        </g>)}
      </svg>
    </div>
    <div className="automation-flow-summary"><div className="automation-flow-copy"><strong role="status">{view.title}</strong><p>{view.description}</p></div>
      {view.metric && <div className="automation-flow-metric"><span>{view.metric.label}</span><div><strong>{view.metric.value}</strong>{view.metric.unit && <small>{view.metric.unit}</small>}</div></div>}
    </div>
    {detailOpen && <Dialog title="自动定点运行详情" close={() => setDetailOpen(false)} className="automation-flow-detail-dialog">
      <div className="automation-flow-detail-content">
        {flow?.context && <p>{flow.context.flowName} · {flow.context.target}{view.roundLabel ? ` · ${view.roundLabel}` : ''}</p>}
        {state?.message && <p>{state.message}</p>}
        {details}
        {!!flow?.trace.length && <div className="automation-flow-trace"><strong>本轮轨迹</strong><ol>{flow.trace.map(item => <li key={item.seq}>{names[item.node]}{item.attemptIndex > 0 ? ` · 第 ${item.attemptIndex} 次尝试` : ''}</li>)}</ol></div>}
      </div>
    </Dialog>}
  </section>;
}
