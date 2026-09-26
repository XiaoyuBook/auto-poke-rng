import { useCallback, useEffect, useRef, useState } from 'react';
import { fromFile, isScriptDirty, scriptError, type LibraryScript, type ScriptFolder } from './scriptLibrary';

export function useScriptLibrary() {
  const api = window.desktop?.scripts;
  const [scripts, setScripts] = useState<LibraryScript[]>([]);
  const [folders, setFolders] = useState<ScriptFolder[]>([]);
  const [selected, setSelected] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const pending = useRef(false);
  const active = scripts.find(script => script.path === selected) || scripts[0];
  useEffect(() => { setSelected(active?.path || ''); }, [active?.path]);

  const refresh = useCallback(async () => {
    if (!api || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const listing = await api.list();
      setSelected(current => listing.aliases?.[current] || current);
      setRootPath(listing.rootPath);
      setFolders(listing.folders);
      setWarnings(listing.warnings);
      setScripts(current => {
        const previous = new Map(current.map(script => [script.path, script]));
        const next = listing.files.map(file => {
          const old = previous.get(file.path);
          previous.delete(file.path);
          return old && isScriptDirty(old) ? { ...old, missing: false, diskChanged: old.saved.revision !== file.revision } : fromFile(file);
        });
        // Keep edited files even if they were removed outside the application.
        return [...next, ...[...previous.values()].filter(isScriptDirty).map(script => ({ ...script, missing: true }))];
      });
      setLoaded(true);
      setError('');
    } catch (cause) { setError(scriptError(cause)); }
    finally { pending.current = false; setBusy(false); }
  }, [api]);

  useEffect(() => { void refresh(); }, [refresh]);

  const update = (changes: Partial<Pick<LibraryScript, 'name' | 'body'>>) => {
    if (active) setScripts(current => current.map(script => script.path === active.path ? { ...script, ...changes } : script));
  };
  const create = async (folder: string) => {
    if (!api || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const file = await api.create(folder);
      setScripts(current => [...current, fromFile(file)]);
      setSelected(file.path);
      setError('');
    } catch (cause) { setError(scriptError(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  const save = useCallback(async () => {
    if (!api || !active || pending.current || !isScriptDirty(active)) return false;
    pending.current = true;
    setBusy(true);
    try {
      const file = await api.save({ path: active.path, name: active.name, body: active.body, expectedRevision: active.saved.revision });
      setScripts(current => current.map(script => script.path === active.path ? {
        ...fromFile(file),
        // Typing and selecting other scripts can continue while disk I/O is pending.
        name: script.name === active.name ? file.name : script.name,
        body: script.body,
      } : script));
      setSelected(current => current === active.path || !current ? file.path : current);
      setError('');
      return true;
    } catch (cause) { setError(scriptError(cause)); throw cause; }
    finally { pending.current = false; setBusy(false); }
  }, [active, api]);

  return {
    scripts, folders, active, rootPath, error, warnings, busy, loaded, available: Boolean(api),
    saved: Boolean(active && !isScriptDirty(active)), select: setSelected, update, create, save, refresh,
  };
}
