import type { LogEntry } from './workspace';
import type { ScriptFilesApi } from './scriptLibrary';

export type PanelTool = 'video' | 'logs';
export type LogSource = '全部来源' | LogEntry['source'];
export interface PanelWindowState {
  detached: PanelTool[];
  logs: LogEntry[];
  logSource: LogSource;
  alwaysOnTop: boolean;
  videoLabelsOpen: boolean;
}
export type PanelAction = { type: 'dock'; tool: PanelTool } | { type: 'clear-logs' };
export interface PanelWindowsApi {
  open: (tool: PanelTool) => Promise<void>;
  getState: () => Promise<PanelWindowState>;
  publishLogs: (logs: LogEntry[]) => Promise<void>;
  setLogSource: (source: LogSource) => Promise<void>;
  clearLogs: () => Promise<void>;
  dock: () => Promise<void>;
  setAlwaysOnTop: (enabled: boolean) => Promise<void>;
  setVideoLabelsOpen: (open: boolean) => Promise<void>;
  onState: (listener: (state: PanelWindowState) => void) => () => void;
  onAction: (listener: (action: PanelAction) => void) => () => void;
}
export interface StaticGenerationRequest {
  seed0: string; seed1: string; initialAdvances: number; maxAdvances: number; offset: number; lead: number;
  target: string;
  profile: import('./bdspProfile').BdspProfile;
  filter: { skip: boolean; ability: number; gender: number; shiny: number; heightMin: number; heightMax: number; weightMin: number; weightMax: number; ivMin: number[]; ivMax: number[]; natures: boolean[] };
}
export interface NativeStaticResult {
  advances: number; ec: string; pid: string; ivs: number[]; stats: number[]; ability: number; abilityIndex: number; gender: number; level: number;
  nature: number; shiny: number; height: number; weight: number; characteristic: number;
}
export interface StaticEngineApi {
  staticGenerate: (request: StaticGenerationRequest) => Promise<NativeStaticResult[]>;
  cancel: () => Promise<void>;
  calculateIvs: (request: IvCalculationRequest) => Promise<IvCalculationResult>;
}
export interface IvCalculationRequest {
  species: number; form: number; nature: number; characteristic: number; hiddenPower: number;
  entries: { level: number; stats: number[] }[];
}
export interface IvCalculationResult {
  ivs: number[][]; baseStats: number[]; nextLevels: (number | null)[]; possible: boolean;
}
export interface ControllerOverlayState {
  visible: boolean; active: boolean; mode: 'off' | 'standby' | 'active'; scale: number;
  inputReport?: import('./devices').ControllerReport | null;
}
export interface ControllerOverlayApi {
  getState: () => Promise<ControllerOverlayState>;
  show: () => Promise<ControllerOverlayState>;
  hide: () => Promise<ControllerOverlayState>;
  toggle: () => Promise<ControllerOverlayState>;
  toggleActive: () => Promise<ControllerOverlayState>;
  setActive: (active: boolean) => Promise<ControllerOverlayState>;
  suspend: () => Promise<ControllerOverlayState>;
  resume: () => Promise<ControllerOverlayState>;
  setMapping: (mapping: Record<string, string | null>) => Promise<ControllerOverlayState>;
  resetPosition: () => Promise<void>;
  moveBy: (dx: number, dy: number) => Promise<void>;
  setScale: (scale: number) => Promise<ControllerOverlayState>;
  onState: (listener: (state: ControllerOverlayState) => void) => () => void;
  onInput: (listener: (event: unknown) => void) => () => void;
  onError: (listener: (error: { message: string }) => void) => () => void;
}

export interface DesktopApi {
  scriptRepository?: import('./scriptRepository').ScriptRepositoryApi;
  automation?: import('./automation').AutomationApi;
  blink?: import('./blink').BlinkApi;
  notifications?: import('./notifications').QQApi;
  devices?: import('./devices').DevicesApi;
  overlay?: ControllerOverlayApi;
  getMetadata: () => Promise<{ name: string; version: string; platform: string }>;
  panels: PanelWindowsApi;
  scripts: ScriptFilesApi;
  rng?: StaticEngineApi;
}
