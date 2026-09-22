import { useCallback, useState } from 'react';
import type { GameId } from './workspace';
import { defaultScriptId, isScriptSaved, persistScriptLibrary, readScriptLibrary, type LibraryScript } from './scriptLibrary';

export function useScriptLibrary(game: GameId) {
  const [scripts, setScripts] = useState(readScriptLibrary);
  const [selected, setSelected] = useState<Record<GameId, string>>({
    frlg: defaultScriptId('frlg'), bdsp: defaultScriptId('bdsp'), swsh: defaultScriptId('swsh'),
  });
  const available = scripts.filter(script => script.game === game);
  const active = available.find(script => script.id === selected[game]) || available[0];

  const select = (id: string) => {
    if (available.some(script => script.id === id)) setSelected(current => ({ ...current, [game]: id }));
  };
  const update = (changes: Partial<Pick<LibraryScript, 'name' | 'body'>>) => {
    setScripts(current => current.map(script => script.id === active.id ? { ...script, ...changes } : script));
  };
  const create = () => {
    let name = '未命名脚本';
    let number = 2;
    while (available.some(script => script.name === name)) name = '未命名脚本 ' + number++;
    const entry: LibraryScript = { id: game + ':' + crypto.randomUUID(), game, name, body: '# 在此编写脚本\n', description: '本机草稿', example: false };
    setScripts(current => [entry, ...current]);
    setSelected(current => ({ ...current, [game]: entry.id }));
  };
  const save = useCallback(() => {
    const name = active.name.trim() || '未命名脚本';
    const next = scripts.map(script => script.id === active.id
      ? { ...script, name, description: '本机脚本', example: false, saved: { name, body: script.body } } : script);
    persistScriptLibrary(next);
    setScripts(next);
  }, [active, scripts]);

  return { scripts: available, active, saved: isScriptSaved(active), select, update, create, save };
}
