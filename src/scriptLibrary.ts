import { games, initialScript, readDrafts, type GameId } from './workspace';

export interface LibraryScript {
  id: string;
  game: GameId;
  name: string;
  body: string;
  description: string;
  example: boolean;
  saved?: { name: string; body: string };
}

export const libraryStorageKey = 'auto-poke-rng:script-library';
const templates = [
  { key: 'draft', name: '未命名脚本', description: '本机草稿', body: initialScript, example: false },
  { key: 'confirm', name: '等待与确认', description: '等待后按下确认键', body: '# 等待画面稳定，然后按下确认键\n\nwait 1000\npress A\nwait 500\npress A\n', example: true },
  { key: 'menu', name: '菜单操作', description: '确认与返回的输入示例', body: '# 顺序输入示例\n# 运行仅用于预览界面反馈\n\npress A\nwait 800\npress B\nwait 500\n', example: true },
];

export const defaultScriptId = (game: GameId) => game + ':draft';
export const isScriptSaved = (script: LibraryScript) => Boolean(script.saved && script.name === script.saved.name && script.body === script.saved.body);
export function isScriptDirty(script: LibraryScript) {
  if (script.saved) return !isScriptSaved(script);
  const template = templates.find(item => script.id === script.game + ':' + item.key);
  return !script.example || !template || script.name !== template.name || script.body !== template.body;
}

export function readScriptLibrary(): LibraryScript[] {
  const entries = new Map<string, LibraryScript>();
  for (const game of games) {
    for (const { key, ...template } of templates) {
      const entry = { ...template, id: game.id + ':' + key, game: game.id };
      entries.set(entry.id, entry);
    }
  }
  // Carry forward the previous per-game drafts without deleting their storage.
  const legacy = readDrafts();
  for (const game of legacy.saved) {
    const entry = entries.get(defaultScriptId(game))!;
    entry.body = legacy.drafts[game];
    entry.saved = { name: entry.name, body: entry.body };
  }
  try {
    const stored = JSON.parse(localStorage.getItem(libraryStorageKey) || 'null');
    if (stored?.version === 1 && Array.isArray(stored.scripts)) {
      for (const item of stored.scripts) {
        if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || typeof item.body !== 'string'
          || !games.some(game => game.id === item.game)) continue;
        entries.set(item.id, {
          id: item.id, game: item.game, name: item.name, body: item.body, description: '本机脚本', example: false,
          saved: { name: item.name, body: item.body },
        });
      }
    }
  } catch { /* Keep the templates and migrated drafts if library storage is unavailable. */ }
  return [...entries.values()];
}

export function persistScriptLibrary(scripts: LibraryScript[]) {
  const saved = scripts.filter(script => script.saved).map(script => ({
    id: script.id, game: script.game, name: script.saved!.name, body: script.saved!.body,
  }));
  localStorage.setItem(libraryStorageKey, JSON.stringify({ version: 1, scripts: saved }));
}
