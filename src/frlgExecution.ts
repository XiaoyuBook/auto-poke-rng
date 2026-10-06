import type { FrlgPlannerRequest } from './frlgAutomation';

export type FrlgRunOptions = {
  entry?: 'formal' | 'timeline';
  paralysis?: boolean; false_swipe?: boolean; continue_capture_after_shiny?: boolean;
  home_buffer_adaptive_threshold?: boolean; seed_startup_scheme?: number; seed_calibration_scheme?: number;
  item_rng_mode?: boolean; party_empty_slots?: number; update_precalibration?: boolean;
  debug_log_output?: number; frame_parity_scheme?: number;
  reverse_expansion_layers?: number; reverse_expansion_seed_tolerances?: number[];
  reverse_expansion_frame_half_widths?: number[]; togepi_seed_reverse_frame_half_width?: number;
  record_shiny_video?: boolean; stop_on_non_target_shiny?: boolean;
  auto_complete_pokedex?: boolean;
  precalibration_seed_ns1?: number; precalibration_seed_ns2?: number;
  precalibration_frame_ns1?: number; precalibration_frame_ns2?: number;
};
export type FrlgRunLog = {
  id: string;
  time: string;
  source: '火叶' | 'ECS';
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  phase?: string;
  line?: number;
  detailOnly?: boolean;
};
export type FrlgBingoCell = { seed: number; frame: number; count: number; marker: string };
export type FrlgBingoState = {
  version: number; axis: number[]; seedText: string[]; grid: FrlgBingoCell[][];
  observed?: boolean;
  prediction?: { seed: number; seedRadius: number; frame: number; frameRadius: number };
  tv: { enabled: boolean; current: number; inRange?: boolean; prediction: number; radius: number; counts: number[]; cells: FrlgBingoCell[] };
  current: { seed: number; frame: number; hitSeed: number; hitFrame: number; inRange: boolean; inDeadZone: boolean };
  context: { seedTolerance: number; targetIndex: number; seedMaxIndex: number; game: number; seedMode: number; enterTv: boolean; tvFrameCost: number };
  stable: { type: number; count: number; threshold: number; seed: number; frame: number; result: boolean };
  count: number;
};
export type FrlgRunState = {
  status: 'idle' | 'preparing' | 'running' | 'stopping' | 'stopped' | 'completed' | 'failed';
  runId: string | null; profileId: string | null; message: string; logs: string[]; logEntries?: FrlgRunLog[];
  progress?: { source: string; line: number; action: string; text: string } | null;
  calibrationUpdated?: boolean; bingo?: FrlgBingoState | null;
  dexCompletion?: { speciesId: number; evidence: 'target_shiny' | 'full_target_hit' } | null;
};
export type FrlgRunInput = { request: FrlgPlannerRequest; profileId: string; options: FrlgRunOptions };
export const frlgRunBusy = (state: FrlgRunState | null) => !!state && ['preparing', 'running', 'stopping'].includes(state.status);

export const isFrlgDiagnosticLog = (message: string, detailOnly = false) => {
  const text = String(message).trim();
  return detailOnly
    || text.startsWith('FRLG_STAGE|BEGIN|')
    || text.startsWith('FRLG_STAGE|END|')
    || text.startsWith('FRLG_STAGE|PROGRESS|')
    || text.startsWith('FRLG_STAGE|THRESHOLD|')
    || /^阶段(?:开始|完成)：/.test(text);
};

export function loadFrlgRunOptions(profileId: string): FrlgRunOptions {
  try {
    const value = JSON.parse(localStorage.getItem('auto-poke-frlg-run:' + profileId) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  catch { return {}; }
}
