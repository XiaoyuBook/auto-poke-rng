import { useEffect, useState } from 'react';
import type { DeviceConnectionsState } from './devices';

const initial: DeviceConnectionsState = { preferences: { version: 1, autoReconnect: false }, busy: false, result: null };
export function useDeviceConnections() {
  const api = window.desktop?.devices?.connections;
  const [state, setState] = useState(initial);
  const [ready, setReady] = useState(!api);
  useEffect(() => {
    if (!api) return;
    let active = true, updated = false;
    const unsubscribe = api.onState(value => { updated = true; if (active) { setState(value); setReady(true); } });
    void api.getState().then(value => { if (active && !updated) { setState(value); setReady(true); } }).catch(() => { if (active) setReady(true); });
    return () => { active = false; unsubscribe(); };
  }, [api]);
  return { state, ready, api };
}
