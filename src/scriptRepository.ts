export interface RepositoryPackage {
  id: string; name: string; version: string; minimumAppVersion: string; installFolder: string;
  game: string; authors: string[]; description: string; instructions?: string;
}
export interface RepositoryState {
  packages: RepositoryPackage[];
  installed: (RepositoryPackage & { modified: boolean })[];
  rootPath: string; source: string; cached: boolean;
}
export interface InstallPlan {
  token: string; package: RepositoryPackage; installedVersion: string | null;
  changes: { path: string; action: 'add' | 'update' | 'remove' }[]; conflicts: string[];
}
export interface ScriptRepositoryApi {
  getState: () => Promise<RepositoryState>;
  refresh: () => Promise<RepositoryState>;
  prepare: (id: string) => Promise<InstallPlan>;
  importZip: () => Promise<InstallPlan | null>;
  apply: (input: { token: string; policy: 'keep' | 'replace' }) => Promise<{ state: RepositoryState; kept: number; backupPath: string | null }>;
}
