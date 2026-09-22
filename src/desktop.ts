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

export interface DesktopApi {
  devices?: import('./devices').DevicesApi;
  getMetadata: () => Promise<{ name: string; version: string; platform: string }>;
  panels: PanelWindowsApi;
  scripts: ScriptFilesApi;
}
