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
  precalibration_seed_ns1?: number; precalibration_seed_ns2?: number;
  precalibration_frame_ns1?: number; precalibration_frame_ns2?: number;
};
export type FrlgRunState = {
  status: 'idle' | 'preparing' | 'running' | 'stopping' | 'stopped' | 'completed' | 'failed';
  runId: string | null; profileId: string | null; message: string; logs: string[];
  progress?: { source: string; line: number; action: string; text: string } | null;
  calibrationUpdated?: boolean;
};
export type FrlgRunInput = { request: FrlgPlannerRequest; profileId: string; options: FrlgRunOptions };
export const frlgRunBusy = (state: FrlgRunState | null) => !!state && ['preparing', 'running', 'stopping'].includes(state.status);

export function loadFrlgRunOptions(profileId: string): FrlgRunOptions {
  try {
    const value = JSON.parse(localStorage.getItem('auto-poke-frlg-run:' + profileId) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  catch { return {}; }
}
