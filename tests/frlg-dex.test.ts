import { expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { FRLG_GAMES, defaultFrlgStaticRequest, validateFrlgStaticRequest } from '../src/frlgAutomation';
import { getFrlgDex } from '../src/frlgDex';

it('offers only valid version-specific search routes, with bundled sprites for every entry', () => {
  for (const game of FRLG_GAMES) {
    const { entries, routes } = getFrlgDex(game);
    expect(entries.length).toBeGreaterThan(0);
    expect(new Set(entries.map(entry => entry.id)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(existsSync(`src/assets/frlg-targets/normal/${entry.id}.png`)).toBe(true);
      for (const route of routes.get(entry.id)!) {
        expect(validateFrlgStaticRequest({ ...defaultFrlgStaticRequest(), ...route, game })).toEqual([]);
      }
    }
    expect(entries.some(entry => entry.id === 152)).toBe(false);
    expect(entries.some(entry => entry.id === 252)).toBe(false);
    expect(entries.some(entry => entry.id === 151)).toBe(false);
    if (game.includes('_jpn_')) expect(entries.map(entry => entry.id)).toEqual([1,4,7]);
    else {
      expect(entries.some(entry => entry.id === 25)).toBe(true);
      expect(entries.some(entry => entry.id === 123)).toBe(game.startsWith('fr'));
      expect(entries.some(entry => entry.id === 127)).toBe(game.startsWith('lg'));
      expect(entries.some(entry => entry.id === 246)).toBe(true);
    }
  }
});
