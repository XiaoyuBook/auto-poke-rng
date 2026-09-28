import { describe, expect, test } from 'vitest';
import { deriveStaticFlowView } from '../src/components/StaticFlowStatusCard';

const context = { flowId: 'a', flowName: '骑拉帝纳', target: '骑拉帝纳', loopMode: 'count', loopCount: 10, maxAdvances: 100000, start: 'script' };
function state(phase, node, options = {}) {
  const { progress: progressOverrides, nextNode, transition, ...stateOverrides } = options;
  return { status: 'running', kind: 'static', runId: 'run-1', message: '旧日志文字', revision: 1,
    progress: { phase, loop_index: 3, activity_id: 6, attempt_index: 2, seed_text: '', log_message: '旧日志文字', ...progressOverrides },
    flow: { runId: 'run-1', context, node, nextNode: nextNode || null, phase, roundIndex: 3, attemptIndex: 2, activityId: 6,
      transitionSeq: 4, transition: transition || null, trace: [] }, ...stateOverrides };
}
describe('automatic static flow status', () => {
  test('keeps the calibration node during the internal decision, then shows a direct wait route', () => {
    const deciding = deriveStaticFlowView(state('决策过帧', 'calibrate'));
    expect(deciding.node).toBe('calibrate');
    expect(deciding.title).toBe('正在判断下一步');
    const waiting = deriveStaticFlowView(state('等待触发', 'wait', {
      nextNode: 'hit', transition: { seq: 4, from: 'calibrate', to: 'wait', roundIndex: 3, at: 1 },
      progress: { remaining_to_trigger: 94, trigger_advances: 10403, current_advances: 10309 },
    }));
    expect(waiting.description).toContain('直接进入等待');
    expect(waiting.metric).toEqual({ label: '距启动还需', value: '94', unit: 'Adv' });
    expect(waiting.nextNode).toBe('hit');
    expect(waiting.roundLabel).toBe('第 3 / 10 轮');
  });
  test('uses the actual planned advance amount and live capture stage', () => {
    const advance = deriveStaticFlowView(state('运行过帧脚本', 'advance', { nextNode: 'seed', progress: { requested_advances: 12000 } }));
    expect(advance.metric).toEqual({ label: '本次计划推进', value: '12,000', unit: 'Adv' });
    const solving = deriveStaticFlowView(state('捕获Seed', 'seed', { capture: { captureId: 'c', stage: 'solving', captured: 40, target: 40, activityId: 6 } }));
    expect(solving.title).toBe('正在解算 Seed');
    expect(solving.metric).toBeNull();
    const staleCapture = deriveStaticFlowView(state('捕获Seed', 'seed', { capture: { captureId: 'old', stage: 'capturing', captured: 40, target: 40, activityId: 5 } }));
    expect(staleCapture.metric).toBeNull();
  });
  test('distinguishes stopping, unknown result, shiny recording and normal completion', () => {
    const stopping = deriveStaticFlowView({ ...state('等待触发', 'wait', { nextNode: 'hit' }), status: 'stopping' });
    expect(stopping.active).toBe(false);
    expect(stopping.nextNode).toBeNull();
    const unknown = deriveStaticFlowView({ ...state('失败', 'hit', { progress: { result_kind: 'unknown' } }), status: 'failed' });
    expect(unknown.title).toContain('需人工确认');
    const recording = deriveStaticFlowView(state('循环检查', 'result', { progress: { activity_kind: 'recording', result_kind: 'shiny', recording_status: 'running' } }));
    expect(recording.title).toContain('正在自动录像');
    const recordingFailed = deriveStaticFlowView({ ...state('已完成', 'result', { progress: { result_kind: 'shiny', recording_status: 'failed' } }), status: 'completed' });
    expect(recordingFailed.title).toBe('已出闪，录像失败');
    const completed = deriveStaticFlowView({ ...state('已完成', 'result', { progress: { result_kind: 'no_candidates' } }), status: 'completed' });
    expect(completed.title).toContain('无候选');
    expect(completed.active).toBe(false);
  });
  test('shows script and OCR observation as parallel activities', () => {
    const observing = deriveStaticFlowView(state('运行撞闪脚本', 'hit', {
      shiny: { scriptId: 'one', scriptStatus: 'running', stage: 'first_seen', keyword: '出现了！' },
    }));
    expect(observing.title).toContain('撞帧中');
    expect(observing.description).toContain('等待第二条');
    expect(observing.metric.value).toBe('第 2 次');
  });
});
