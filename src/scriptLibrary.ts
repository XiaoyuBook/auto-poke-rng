export interface ScriptFile {
  path: string;
  name: string;
  body: string;
  revision: string;
}

export interface ScriptFolder { path: string; name: string }
export interface ScriptListing {
  rootPath: string;
  folders: ScriptFolder[];
  files: ScriptFile[];
  warnings: string[];
  aliases?: Record<string, string>;
}
export interface ScriptFilesApi {
  list: () => Promise<ScriptListing>;
  create: (folder: string) => Promise<ScriptFile>;
  save: (script: { path: string; name: string; body: string; expectedRevision: string }) => Promise<ScriptFile>;
  labelsList?: (folder?: string) => Promise<LabelListing>;
  labelRead?: (folder: string, name: string) => Promise<LabelRecord>;
  labelSave?: (label: LabelSaveRequest) => Promise<LabelRecord>;
}

export interface LabelRect { x: number; y: number; width: number; height: number }
export interface LabelRecord {
  name: string; path: string; searchMethod: number; threshold: number;
  imageBase64?: string; range: LabelRect; target: LabelRect;
}
export interface LabelListing { folder: string; labels: LabelRecord[]; warnings: string[] }
export interface LabelSaveRequest {
  folder: string; name: string; searchMethod: number; threshold: number;
  range: LabelRect; target: LabelRect; imageBase64: string;
}

export interface LibraryScript extends ScriptFile {
  saved: ScriptFile;
  diskChanged?: boolean;
  missing?: boolean;
}
export const fromFile = (file: ScriptFile): LibraryScript => ({ ...file, saved: file });
export const isScriptDirty = (script: LibraryScript) => script.name !== script.saved.name || script.body !== script.saved.body;
export const parentFolder = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
export const scriptError = (error: unknown) => error instanceof Error
  ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '无法访问脚本文件，请重试。';
