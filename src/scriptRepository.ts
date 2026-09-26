import { scriptError } from './scriptLibrary';
import type { GameId } from './workspace';

export const repositoryGames: { id: GameId; name: string; description: string }[] = [
  { id: 'frlg', name: '火红／叶绿', description: '火红与叶绿' },
  { id: 'bdsp', name: '珍钻复刻', description: '晶灿钻石与明亮珍珠' },
  { id: 'swsh', name: '剑／盾', description: '剑与盾' },
];
export function repositoryGame(value: string) {
  const key = value.toLowerCase();
  return repositoryGames.find(game => game.id === key || game.name === value || game.description === value)?.id || key;
}
export const gameName = (value: string) => repositoryGames.find(game => game.id === repositoryGame(value))?.name || value;
export const repositoryText = (value: string) => value.replace(/\bBDSP\b/gi, '珍钻复刻').replace(/\bFRLG\b/gi, '火红／叶绿').replace(/\bSWSH\b/gi, '剑／盾');
export const repositoryCategories = ['过帧脚本', '过场脚本', '反查脚本', '撞帧脚本', '逃跑脚本', '测种脚本'] as const;
export const retiredRepositoryPackages = new Set(['bdsp-ocr-page', 'bdsp-record']);
const legacyCategories: Record<string, string> = {
  'bdsp-advance': '过帧脚本', 'bdsp-advance-optimized': '过帧脚本', 'bdsp-pokedex-advance': '过帧脚本',
  'bdsp-darkrai-cutscene': '过场脚本',
  'bdsp-darkrai-reverse': '反查脚本', 'bdsp-ramanas-reverse': '反查脚本', 'bdsp-reverse': '反查脚本',
  'bdsp-roamer-reverse': '反查脚本', 'bdsp-starter-reverse': '反查脚本',
  'bdsp-arceus': '撞帧脚本', 'bdsp-cresselia': '撞帧脚本', 'bdsp-darkrai': '撞帧脚本',
  'bdsp-giratina': '撞帧脚本', 'bdsp-mesprit': '撞帧脚本', 'bdsp-name': '撞帧脚本',
  'bdsp-ramanas': '撞帧脚本', 'bdsp-shaymin': '撞帧脚本', 'bdsp-starter-hit': '撞帧脚本',
  'bdsp-seed': '测种脚本', 'bdsp-starter-seed': '测种脚本', 'bdsp-tid-seed': '测种脚本',
  'bdsp-underground-seed': '测种脚本',
};
export function repositoryCategory(item: RepositoryPackage) {
  const category = item.files?.find(file => /\.(txt|rng)$/i.test(file.path))?.category;
  return category && (repositoryCategories as readonly string[]).includes(category) ? category : legacyCategories[item.id] || '其他脚本';
}
export function repositoryError(cause: unknown) {
  const message = scriptError(cause);
  return /fetch failed|network|offline|ERR_|timeout/i.test(message) ? '无法连接官方脚本仓库。请检查网络或系统代理后重试，也可以导入本地脚本包。' : message;
}
export const newerVersion = (available: string, installed: string) => {
  const left = available.split('.').map(Number), right = installed.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i];
  return false;
};
export interface RepositoryFile { path: string; bytes: number; sha256: string; category?: string }
export interface RepositoryPackage {
  id: string; name: string; version: string; minimumAppVersion: string; installFolder: string;
  game: string; authors: string[]; description: string; instructions?: string;
  files?: RepositoryFile[]; readme?: string; updatedAt?: string;
}
export interface RepositoryState {
  packages: RepositoryPackage[];
  categoryReadmes?: Record<string, string>;
  installed: (RepositoryPackage & { modified: boolean })[];
  rootPath: string; source: string; cached: boolean;
  catalogSource?: 'bundled' | 'cache' | 'remote' | 'empty';
  channel?: 'github' | 'gitee';
  sources?: Record<'github' | 'gitee', { name: string; url: string }>;
}
export interface InstallPlan {
  token: string; package: RepositoryPackage; installedVersion: string | null;
  changes: { path: string; action: 'add' | 'update' | 'remove' }[]; conflicts: string[];
  migrations?: { from: string; to: string }[];
}
export interface DirectoryMigrationPlan { token: string; from: string; to: string; files: number; bytes: number }
export interface ScriptRepositoryApi {
  getState: () => Promise<RepositoryState>;
  refresh: () => Promise<RepositoryState>;
  prepare: (id: string) => Promise<InstallPlan>;
  importZip: () => Promise<InstallPlan | null>;
  openDirectory?: () => Promise<void>;
  chooseDirectory?: () => Promise<DirectoryMigrationPlan | null>;
  migrateDirectory?: (token: string) => Promise<{ state: RepositoryState; rootPath: string; backupPath: string }>;
  setChannel?: (channel: 'github' | 'gitee') => Promise<RepositoryState>;
  details?: (id: string) => Promise<RepositoryPackage>;
  apply: (input: { token: string; policy: 'keep' | 'replace' }) => Promise<{ state: RepositoryState; kept: number; backupPath: string | null; warning?: string }>;
}
