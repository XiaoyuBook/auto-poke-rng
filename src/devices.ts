export type DeviceStatus = 'idle' | 'connecting' | 'connected' | 'failed';
export interface VideoDevice { id: string; name: string; backend: string; index: number }
export interface ControllerReport { buttons: number; hat: number; lx: number; ly: number; rx: number; ry: number }
export interface DeviceState { status: DeviceStatus; message?: string; code?: string; name?: string; running?: boolean; owned?: boolean; report?: ControllerReport }
export interface VideoState extends DeviceState {
  deviceId?: string; backend?: string; width?: number; height?: number; reportedFps?: number;
  session?: string; previewUrl?: string;
}
export interface DevicesState { video: VideoState; controller: DeviceState }
export interface Snapshot { url: string; session: string; sequence: string; width: number; height: number }
export interface ScriptDiagnostic { message: string; source?: string; line?: number; column?: number }
export interface ScriptProgress { source: string; line: number; column: number; action: string; text: string; caller?: { source: string; line: number } | null; loops?: { source: string; line: number; column: number; iteration: number; total?: number | null }[] }
export interface ScriptEvent extends Partial<ScriptProgress> { event: string; runId: string; status?: string; message?: string; phase?: string }
export interface DevicesApi {
  getState: () => Promise<DevicesState>;
  onState: (listener: (state: DevicesState) => void) => () => void;
  onEvent: (listener: (event: ScriptEvent) => void) => () => void;
  controller: {
    list: () => Promise<{ id: string; name: string }[]>;
    connect: (port: string) => Promise<void>;
    disconnect: () => Promise<void>;
    press: (key: string) => Promise<void>;
    key: (key: string, down: boolean) => Promise<void>;
    stick: (side: 'LS' | 'RS', x: number, y: number) => Promise<void>;
    reset: () => Promise<void>;
    stop: () => Promise<void>;
  };
  execution: {
    start: (script: { text: string; path: string }) => Promise<{ runId: string }>;
    validate: (script: { text: string; path: string }) => Promise<{ valid?: boolean; cancelled?: boolean; diagnostic?: ScriptDiagnostic }>;
    stop: () => Promise<void>;
  };
  video: {
    list: (backend: string) => Promise<VideoDevice[]>;
    connect: (config: { deviceId: string; backend: string; width: number; height: number; fps: number }) => Promise<void>;
    disconnect: () => Promise<void>;
    snapshot: () => Promise<Snapshot>;
    getSnapshot: () => Promise<Snapshot | null>;
    ocr: (imageBase64: string, language?: string) => Promise<{ text: string; confidence: number }>;
    onSnapshot: (listener: (snapshot: Snapshot) => void) => () => void;
  };
}
