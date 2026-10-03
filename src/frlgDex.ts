import { FRLG_STATIC_CATEGORIES, FRLG_WILD_CATEGORIES, getFrlgStaticTargets, getFrlgWildLocations, getFrlgWildTargets, type FrlgRngMethod } from './frlgAutomation';
import { FRLG_SPECIES_METADATA } from './frlgMetadata';

const speciesMetadata = Object.entries(FRLG_SPECIES_METADATA).map(([species, metadata]) => ({ species, id: metadata.id, name: metadata.label })).sort((a, b) => a.id - b.id);
export type FrlgDexRoute = { pokemon: string; method: FrlgRngMethod; category: string; location: string };
export type FrlgTargetIntent = { profileId: string; route: FrlgDexRoute };

// Availability comes from the same version-specific tables as the search dialog.
// A search route does not imply that the execution script supports that route.
export function getFrlgDexRoutes(game: string): Map<number, FrlgDexRoute[]> {
  const result = new Map<number, FrlgDexRoute[]>();
  const add = (id: number, route: FrlgDexRoute) => result.set(id, [...(result.get(id) || []), route]);
  for (const category of FRLG_STATIC_CATEGORIES) {
    if (game.includes('_jpn_') && category !== 'Starter') continue;
    for (const target of getFrlgStaticTargets(game, category)) add(target.speciesId, { pokemon: target.species, method: 'Static 1', category, location: '' });
  }
  if (!game.includes('_jpn_')) for (const category of FRLG_WILD_CATEGORIES) for (const location of getFrlgWildLocations(game, category)) {
    for (const target of getFrlgWildTargets(game, category, location)) add(target.speciesId, { pokemon: target.species, method: 'All Wild Methods', category, location });
  }
  return result;
}

export function getFrlgDex(game: string) {
  const routes = getFrlgDexRoutes(game);
  return { entries: speciesMetadata.filter(entry => routes.has(entry.id)), routes };
}
