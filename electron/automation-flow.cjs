const PHASE_NODES = Object.freeze({
  '运行测种脚本': 'seed', '捕获Seed': 'seed',
  '搜索目标': 'search',
  '运行过帧脚本': 'advance',
  '校正位置': 'calibrate', '运行过场脚本': 'calibrate',
  '最终校准': 'wait', '等待触发': 'wait', '动态调整闪帧': 'wait',
  '运行撞闪脚本': 'hit',
  '运行逃跑脚本': 'result', '反查个体': 'result', '循环检查': 'result', '已完成': 'result',
});

const phaseNode = phase => PHASE_NODES[phase] || null;

function isStaleFlowProgress(flow, progress) {
  if (!flow || !progress) return false;
  if (Number.isInteger(progress.loop_index) && progress.loop_index < flow.roundIndex) return true;
  return Number.isInteger(progress.activity_id) && progress.activity_id < flow.activityId;
}

function createFlow(runId, context) {
  return {
    runId, context, node: null, nextNode: null, phase: null,
    roundIndex: 0, attemptIndex: 0, activityId: 0,
    transitionSeq: 0, transition: null, trace: [],
  };
}

function advanceFlow(flow, progress) {
  if (!flow || !progress) return flow;
  if (isStaleFlowProgress(flow, progress)) return flow;
  const roundIndex = Number.isInteger(progress.loop_index) ? progress.loop_index : flow.roundIndex;
  const nextNode = phaseNode(progress.phase) || flow.node;
  const entered = nextNode !== flow.node;
  const roundChanged = roundIndex > 0 && roundIndex !== flow.roundIndex;
  let transition = flow.transition;
  let transitionSeq = flow.transitionSeq;
  let trace = roundChanged ? [] : flow.trace;
  if ((entered || roundChanged) && nextNode) {
    transitionSeq += 1;
    transition = entered && flow.node ? { seq: transitionSeq, from: flow.node, to: nextNode, roundIndex, at: Date.now() } : null;
    trace = [...trace, { seq: transitionSeq, node: nextNode, phase: progress.phase,
      roundIndex, attemptIndex: progress.attempt_index || 0, activityId: progress.activity_id || 0 }].slice(-32);
  }
  const planned = phaseNode(progress.planned_next_phase);
  return {
    ...flow, node: nextNode, nextNode: planned && planned !== nextNode ? planned : null,
    phase: progress.phase, roundIndex,
    attemptIndex: progress.attempt_index || 0, activityId: progress.activity_id || 0,
    transitionSeq, transition, trace,
  };
}

module.exports = { phaseNode, createFlow, advanceFlow, isStaleFlowProgress };
