import { useEffect, useState } from 'react';

export interface BdspProfile {
  name: string;
  version: 'BD' | 'SP';
  tid: number;
  sid: number;
  dex: boolean;
  charm: boolean;
  oval: boolean;
}
export const defaultBdspProfile: BdspProfile = { name: '-', version: 'BD', tid: 12345, sid: 54321, dex: false, charm: false, oval: false };
const storageKey = 'auto-poke-rng:bdsp-profile';
function loadProfile(): BdspProfile {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (value && ['BD', 'SP'].includes(value.version) && ['tid', 'sid'].every(key => Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 65535)) {
      return { name: typeof value.name === 'string' ? value.name : '-', version: value.version, tid: value.tid, sid: value.sid, dex: value.dex === true, charm: value.charm === true, oval: value.oval === true };
    }
  } catch { /* Invalid or unavailable storage uses the initial profile. */ }
  return { ...defaultBdspProfile };
}
export function useBdspProfile() {
  const [profile, setProfile] = useState(loadProfile);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(profile)); } catch { /* The active profile still works without persistence. */ }
  }, [profile]);
  return [profile, setProfile] as const;
}
