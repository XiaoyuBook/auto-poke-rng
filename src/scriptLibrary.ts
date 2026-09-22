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
}
export interface ScriptFilesApi {
  list: () => Promise<ScriptListing>;
  create: (folder: string) => Promise<ScriptFile>;
  save: (script: { path: string; name: string; body: string; expectedRevision: string }) => Promise<ScriptFile>;
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
