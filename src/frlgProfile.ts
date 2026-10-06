import { useEffect, useState } from 'react';
import { FRLG_GAMES, type FrlgGame } from './frlgAutomation';
import type { FrlgRunState } from './frlgExecution';

export interface FrlgSaveProfile {
  id: string;
  name: string;
  trainerName: string;
  game: FrlgGame;
  tid: number;
  sid: number;
  dexCompleted: boolean;
  completedSpecies?: number[];
}

type FrlgSaveState = { activeId: string; profiles: FrlgSaveProfile[]; completedRunIds?: string[] };

export const defaultFrlgSaveProfile: FrlgSaveProfile = {
  id: 'frlg-save-1', name: '火叶存档 1', trainerName: '-', game: 'fr_nx', tid: 0, sid: 0, dexCompleted: false, completedSpecies: [],
};

const storageKey = 'auto-poke-rng:frlg-saves-v1';

const newId = () => {
  try { return crypto.randomUUID(); } catch { return `frlg-save-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
};

function validId(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 65535;
}

const completedIds = (value: unknown): number[] => Array.isArray(value)
  ? [...new Set(value.filter((id): id is number => Number.isInteger(id) && id >= 1 && id <= 386))].sort((a, b) => a - b) : [];

function normalizeProfile(value: unknown, index: number): FrlgSaveProfile | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<FrlgSaveProfile>;
  if (typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !FRLG_GAMES.includes(item.game as FrlgGame)
    || !validId(item.tid) || !validId(item.sid)) return null;
  return {
    id: item.id,
    name: item.name.trim() || `火叶存档 ${index + 1}`,
    trainerName: typeof item.trainerName === 'string' ? item.trainerName : '-',
    game: item.game as FrlgGame,
    tid: Number(item.tid), sid: Number(item.sid), dexCompleted: item.dexCompleted === true,
    completedSpecies: completedIds(item.completedSpecies),
  };
}

function loadSaves(): FrlgSaveState {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || 'null') as Partial<FrlgSaveState> | null;
    const profiles = Array.isArray(value?.profiles) ? value.profiles.map(normalizeProfile).filter((item): item is FrlgSaveProfile => !!item) : [];
    if (profiles.length) {
      const activeId = profiles.some(item => item.id === value?.activeId) ? String(value?.activeId) : profiles[0].id;
      const completedRunIds = Array.isArray(value?.completedRunIds)
        ? value.completedRunIds.filter((id): id is string => typeof id === 'string').slice(-100) : [];
      return { activeId, profiles, completedRunIds };
    }
  } catch { /* Invalid or unavailable storage falls back to one empty FireRed save. */ }
  return { activeId: defaultFrlgSaveProfile.id, profiles: [{ ...defaultFrlgSaveProfile }] };
}

export function useFrlgSaves() {
  const [state, setState] = useState<FrlgSaveState>(loadSaves);
  useEffect(() => {
    const api = window.desktop?.frlgAutomation;
    if (!api) return;
    let alive = true;
    const complete = (run: FrlgRunState) => {
      const { runId, profileId } = run;
      const speciesId = run.dexCompletion?.speciesId;
      if (!alive || run.status !== 'completed' || !runId || !profileId || typeof speciesId !== 'number'
          || !Number.isInteger(speciesId) || speciesId < 1 || speciesId > 386) return;
      setState(current => {
        if (current.completedRunIds?.includes(runId) || !current.profiles.some(item => item.id === profileId)) return current;
        return { ...current, completedRunIds: [...(current.completedRunIds || []), runId].slice(-100),
          profiles: current.profiles.map(item => item.id === profileId ? {
            ...item, completedSpecies: completedIds([...(item.completedSpecies || []), speciesId]),
          } : item) };
      });
    };
    const unsubscribe = api.onState(complete);
    void api.getState().then(complete).catch(() => {});
    return () => { alive = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* The active save remains available for this session. */ }
  }, [state]);
  const active = state.profiles.find(item => item.id === state.activeId) || state.profiles[0] || defaultFrlgSaveProfile;
  const select = (id: string) => setState(current => current.profiles.some(item => item.id === id) ? ({ ...current, activeId: id }) : current);
  const save = (profile: FrlgSaveProfile) => setState(current => {
    if (!current.profiles.some(item => item.id === profile.id)) return current;
    return { ...current, profiles: current.profiles.map(item => item.id === profile.id ? { ...profile, completedSpecies: completedIds(profile.completedSpecies), name: profile.name.trim() || '未命名存档', trainerName: profile.trainerName.trim() || '-' } : item) };
  });
  const setSpeciesCompleted = (speciesId: number, completed: boolean) => setState(current => {
    if (!Number.isInteger(speciesId) || speciesId < 1 || speciesId > 386) return current;
    return { ...current, profiles: current.profiles.map(item => item.id !== current.activeId ? item : {
      ...item, completedSpecies: completedIds(completed ? [...(item.completedSpecies || []), speciesId] : (item.completedSpecies || []).filter(id => id !== speciesId)),
    }) };
  });
  const create = (copy?: FrlgSaveProfile) => {
    const next: FrlgSaveProfile = { ...(copy || defaultFrlgSaveProfile), completedSpecies: [...(copy?.completedSpecies || [])], id: newId(), name: copy ? `${copy.name} 副本` : `火叶存档 ${state.profiles.length + 1}` };
    setState(current => ({ activeId: next.id, profiles: [...current.profiles, next] }));
    return next;
  };
  return { profiles: state.profiles, activeId: state.activeId, active, select, save, create, setSpeciesCompleted };
}

