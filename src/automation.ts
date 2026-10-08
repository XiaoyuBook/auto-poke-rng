import { useEffect, useState } from 'react';
import type { BlinkConfig } from './blink';
import type { BdspProfile } from './bdspProfile';
import type { StaticGenerationRequest, NativeStaticResult } from './desktop';
import type { LogEntry } from './workspace';

export type AutomationKind = 'static' | 'tid';
export type AutomationRunKind = AutomationKind | 'frlg';
export type OcrRegionRow = { id: string; label: string; rect: { x: number; y: number; width: number; height: number } };
export type TargetFilter = StaticGenerationRequest['filter'];
export type AutomationParameters = {
  start: 'script' | 'capture' | 'reidentify'; loop_mode: 'single' | 'count' | 'infinite'; loop_count: number;
  target: string; filters: TargetFilter[]; lead: number; max_advances: number;
  fixed_delay: number; max_wait_frames: number; reseed_threshold_frames: number; reidentify_max_attempts: number;
  reidentify_failure_policy: 'next_round' | 'recapture_seed'; reidentify_seed_max_attempts: number; reseeding_threshold: number;
  auto_reverse: boolean; escape_continue: boolean; reverse_lookup_window: number; shiny_threshold_seconds: number | null; record_shiny: boolean;
  sync_mode: number; sync_nature: string; blink_name: string; exit_blink_name: string; frame_threshold: number; delay: number; target_display_tids: number[];
  starter_automation?: boolean;
};
export type AutomationConfig = { parameters: AutomationParameters; scripts: Record<string, string> };
export type StaticFeatureKey = 'reverse' | 'exit' | 'sync' | 'escape';
export type StaticAutomationConfig = AutomationConfig & { features: Record<StaticFeatureKey, { added: boolean; enabled: boolean }>; delayConfig: DelayConfig };
export type AutomationConfigGroup = { id: string; name: string; config: StaticAutomationConfig };
export type DelayConfig = { strategy: string; baseline_delay: number; multi_candidate_policy: string; window_size: number; ewma_alpha: number; dense_interval_width: number };
export type DelayProfile = { config: DelayConfig; samples: { candidates: number[]; round_number: number; observed_at: string; excluded: boolean }[]; next_round_number: number };
export type DelayPreview = { value: number; effective_strategy: string; valid_round_count: number; candidate_count: number; used_fallback: boolean; sample_statuses: string[]; used_round_numbers: number[] };
export type IdRow = { advances: number; tid: number; sid: number; tsv: number; display_tid: number };
export type IdResults = { id_states: IdRow[]; id_elapsed_seconds: (number | null)[]; seed_measured_wall_time?: number };
export type AutomationProgress = Partial<IdResults> & {
  phase: string; loop_index: number; seed_text: string; current_advances?: number; raw_target_advances?: number; target_advances?: number;
  trigger_advances?: number; remaining_to_trigger?: number; fixed_delay?: number; log_message: string; last_script_path?: string;
  activity_id?: number; activity_kind?: string; attempt_index?: number; requested_advances?: number | null;
  planned_next_phase?: string | null; result_kind?: string | null; recording_status?: string | null;
  wait_target_wall?: number | null;
  starter_stage?: string | null;
};
export type FlowNode = 'seed' | 'search' | 'advance' | 'calibrate' | 'wait' | 'hit' | 'result';
export type AutomationFlow = {
  runId: string; context: { flowId: string; flowName: string; target: string; loopMode: string; loopCount: number; maxAdvances: number; start: string };
  node: FlowNode | null; nextNode: FlowNode | null; phase: string | null; roundIndex: number; attemptIndex: number; activityId: number;
  transitionSeq: number; transition: { seq: number; from: FlowNode; to: FlowNode; roundIndex: number; at: number } | null;
  trace: { seq: number; node: FlowNode; phase: string; roundIndex: number; attemptIndex: number; activityId: number }[];
};
export type Candidate = Omit<NativeStaticResult, 'pid' | 'ec'> & { pid: string | number; ec: string | number };
export type FrlgRoundRequest = { seedMs: number; f1?: number; tv?: number; f2?: number; menu?: number; held?: number; pickup?: number };
export type FrlgRoundRecord = { request?: FrlgRoundRequest; nextRequest?: FrlgRoundRequest; hitSeed?: string; seedOffset?: number; hitFrame?: number; frameError?: number;
  seedMsError?: number; candidateCount?: number; candidatePointCount?: number; observedLevel?: number; candyCount?: number;
  nextObservationLevel?: number; refinementStatus?: 'refining' | 'resolved' | 'unresolved';
  nextSeedMs?: number; f1?: number; tv?: number; f2?: number; result?: string; notes?: string[] };
export type AutomationRound = { number: number; seed?: string; outcome: string; startedAt?: string; endedAt?: string; frlg?: FrlgRoundRecord; candidates: Candidate[]; selected?: number; sources?: string[];
  interval?: number; trigger?: number; usedDelay?: number; actualDelays?: number[]; reverse?: Candidate[]; events: { event: string; args: unknown[] }[] };
export type AutomationRun = { id: string; kind: AutomationRunKind; context?: AutomationFlow['context'] | { profileId: string; target: string; game: 'frlg' } | null; startedAt: string; endedAt?: string; status: string; message?: string; diagnosticsIncomplete?: boolean; rounds: AutomationRound[] };
export type AutomationSnapshot = {
  config: { static: StaticAutomationConfig; tid: AutomationConfig; ocr: OcrRegionRow[] }; profiles: Record<string, DelayProfile>;
  staticGroups: { activeId: string; items: AutomationConfigGroup[] };
  logs: LogEntry[]; runs: AutomationRun[]; logging: boolean; error: string;
  state: { revision: number; status: string; kind: AutomationKind | null; runId: string | null; message: string; progress: AutomationProgress | null;
    capture?: { captureId?: string; stage?: string; activityId?: number; captured: number; target: number;
      roi?: import('./blink').BlinkRect; location?: import('./blink').BlinkRect; sourceWidth?: number; sourceHeight?: number } | null;
    shiny?: { scriptId?: string; scriptStatus?: string; stage?: string; keyword?: string; intervalSeconds?: number; result?: string } | null;
    activity?: { kind: string; stage: string; activityId: number } | null;
    flow?: AutomationFlow | null; roundDelay?: number; seed?: { seed: { words: string[]; pair: string[] } } | null };
};
export type AutomationInput = { kind: AutomationKind; config: AutomationConfig; blink: BlinkConfig; exitBlink?: BlinkConfig; profile: BdspProfile; calibrate?: boolean };
export type Readiness = { ready: boolean; checks: { label: string; ok: boolean; detail: string }[] };
export interface AutomationApi {
  getState(): Promise<AutomationSnapshot>;
  onState(listener: (snapshot: AutomationSnapshot) => void): () => void;
  check(input: AutomationInput): Promise<Readiness>;
  start(input: AutomationInput): Promise<AutomationSnapshot>;
  stop(): Promise<void>;
  save(input: { kind: AutomationKind; scope: 'parameters' | 'scripts' | 'config'; values: Partial<AutomationParameters> | Record<string, string> | StaticAutomationConfig; expectedId?: string }): Promise<AutomationSnapshot>;
  manageStaticGroup(input: { action: 'create' | 'select' | 'rename' | 'delete'; id?: string; name?: string }): Promise<AutomationSnapshot>;
  saveOcr(rows: OcrRegionRow[]): Promise<AutomationSnapshot>;
  defaultOcr(): Promise<OcrRegionRow[]>;
  ocr(input: { operation: string; field?: string }): Promise<{ text?: string; results?: Record<string, string> }>;
  delay(input: { species: number; action: 'save' | 'clear' | 'exclude'; config?: DelayConfig; number?: number; excluded?: boolean }): Promise<AutomationSnapshot>;
  delayEstimate(profile: DelayProfile): Promise<DelayPreview>;
  calibrate(target: string): Promise<{ interval: number; suggested: number }>;
  tidPreview(input: { seed: string[]; frame_threshold: number }): Promise<IdResults>;
  setLogging(value: boolean): Promise<AutomationSnapshot>;
  clearLogs(): Promise<void>;
  exportDiagnostics(runId: string): Promise<{ canceled: boolean; filePath?: string; active?: boolean; incomplete?: boolean }>;
  log(row: Pick<LogEntry, 'message' | 'source' | 'level'>): Promise<void>;
}
export const automationBusy = (state?: AutomationSnapshot['state']) => !!state && ['starting','running','stopping'].includes(state.status);
export function useAutomation() {
  const api = window.desktop?.automation;
  const [snapshot,setSnapshot] = useState<AutomationSnapshot | null>(null);
  const [error,setError] = useState('');
  useEffect(() => {
    if (!api) return;
    let alive = true, received = false;
    const unsubscribe = api.onState(value => { received = true; if (alive) setSnapshot(value); });
    void api.getState().then(value => { if (alive && !received) setSnapshot(value); }).catch(error => { if (alive) setError(error.message); });
    return () => { alive = false; unsubscribe(); };
  },[api]);
  return { api, snapshot, error, setError, setSnapshot };
}
export function downloadText(text: string, filename: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob(['\ufeff' + text], { type: type + ';charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}
export function nativeCandidate(row: Candidate): NativeStaticResult {
  return { ...row, pid: typeof row.pid === 'number' ? row.pid.toString(16).toUpperCase().padStart(8,'0') : row.pid,
    ec: typeof row.ec === 'number' ? row.ec.toString(16).toUpperCase().padStart(8,'0') : row.ec };
}
