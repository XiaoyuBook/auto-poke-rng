import { useEffect, useState } from 'react';
import type { DevicesState } from './devices';
export const initialDeviceState: DevicesState = { video: { status: 'idle' }, controller: { status: 'idle' } };
export function useDevices() {
  const [state, setState] = useState(initialDeviceState);
  useEffect(() => {
    const api = window.desktop?.devices;
    if (!api) return;
    let active = true, updated = false;
    const unsubscribe = api.onState(value => { updated = true; if (active) setState(value); });
    void api.getState().then(value => { if (active && !updated) setState(value); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, []);
  return state;
}
