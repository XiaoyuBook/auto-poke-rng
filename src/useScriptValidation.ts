import { useEffect, useState } from 'react';
import type { ScriptDiagnostic } from './devices';
import { scriptError } from './scriptLibrary';

export interface ScriptValidation {
  state: 'checking' | 'valid' | 'invalid' | 'unavailable';
  diagnostic?: ScriptDiagnostic;
  message?: string;
}

export function useScriptValidation(path: string, text: string) {
  const api = window.desktop?.devices?.execution;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ path: string; text: string; revision: number; value: ScriptValidation }>();
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  useEffect(() => {
    if (!api?.validate || !path) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api.validate({ path, text }).then(value => {
        if (cancelled || value.cancelled) return;
        setResult({ path, text, revision, value: value.valid ? { state: 'valid' } : {
          state: 'invalid', diagnostic: value.diagnostic,
        } });
      }).catch(error => {
        if (!cancelled) setResult({ path, text, revision, value: { state: 'unavailable', message: scriptError(error) } });
      });
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, path, text, revision]);
  const validation: ScriptValidation = !api?.validate ? { state: 'unavailable', message: '请在桌面应用中检查语法。' }
    : result?.path === path && result.text === text && result.revision === revision ? result.value : { state: 'checking' };
  return { ...validation, retry: () => setRevision(value => value + 1) };
}
