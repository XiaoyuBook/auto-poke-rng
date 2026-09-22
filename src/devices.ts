export type DeviceStatus = 'idle' | 'connecting' | 'connected' | 'failed';
export interface VideoDevice { id: string; name: string; backend: string; index: number }
export interface DeviceState { status: DeviceStatus; message?: string; code?: string; name?: string; running?: boolean; owned?: boolean }
export interface VideoState extends DeviceState {
  deviceId?: string; backend?: string; width?: number; height?: number; reportedFps?: number;
  session?: string; previewUrl?: string;
}
export interface DevicesState { video: VideoState; controller: DeviceState }
export interface Snapshot { url: string; session: string; sequence: string; width: number; height: number }
export interface DevicesApi {
  getState: () => Promise<DevicesState>;
  onState: (listener: (state: DevicesState) => void) => () => void;
  onEvent: (listener: (event: { event: string; runId: string; status?: string; message?: string }) => void) => () => void;
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
    stop: () => Promise<void>;
  };
  video: {
    list: (backend: string) => Promise<VideoDevice[]>;
    connect: (config: { deviceId: string; backend: string; width: number; height: number; fps: number }) => Promise<void>;
    disconnect: () => Promise<void>;
    snapshot: () => Promise<Snapshot>;
    getSnapshot: () => Promise<Snapshot | null>;
    onSnapshot: (listener: (snapshot: Snapshot) => void) => () => void;
  };
}
