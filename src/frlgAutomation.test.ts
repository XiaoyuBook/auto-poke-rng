import { describe, expect, it } from 'vitest';
import {
  FRLG_STATIC_CATEGORIES,
  FRLG_STATIC_TARGETS,
  getFrlgStaticTargets,
  toFrlgPlannerPayload,
  validateFrlgStaticRequest,
  type FrlgStaticRequest,
} from './frlgAutomation';

const baseRequest = (overrides: Partial<FrlgStaticRequest> = {}): FrlgStaticRequest => ({
  game: 'fr_nx', tid: 12345, sid: 54321, method: 'Static 1', category: 'Starter', pokemon: 'Bulbasaur',
  location: '', maxAdvances: 10000, minAdvances: 0,
  ivMin: [0, 0, 0, 0, 0, 0], ivMax: [31, 31, 31, 31, 31, 31],
  shiny: 'Star/Square', nature: 'Any', gender: 'Any', ability: 'Any', hiddenType: 'Any',
  initialSeedResultCount: 1, maxIvCombinations: 25_000_000, seedMode: null,
  directMode: false, directSeed: '', directAdvances: null,
  ...overrides,
});

describe('FRLG automation contract', () => {
  it('keeps the original 2.0 static category order', () => {
    expect(FRLG_STATIC_CATEGORIES).toEqual(['Starter', 'Fossil', 'Gift', 'GameCorner', 'Stationary', 'Legend', 'Event', 'Roaming']);
  });

  it('preserves the FireRed/LeafGreen Game Corner split from the source planner', () => {
    expect(getFrlgStaticTargets('fr_nx', 'GameCorner').map(target => target.species)).toEqual(['Abra', 'Clefairy', 'Scyther', 'Dratini', 'Porygon']);
    expect(getFrlgStaticTargets('lg_nx', 'GameCorner').map(target => target.species)).toEqual(['Abra', 'Clefairy', 'Pinsir', 'Dratini', 'Porygon']);
  });

  it('keeps the shared static targets and rejects unknown game families', () => {
    expect(getFrlgStaticTargets('fr_nx', 'Starter').map(target => target.species)).toEqual(['Bulbasaur', 'Charmander', 'Squirtle']);
    expect(getFrlgStaticTargets('swsh', 'Starter')).toEqual([]);
    expect(FRLG_STATIC_TARGETS).toHaveLength(30);
  });

  it('accepts the ordinary static baseline and returns no diagnostics', () => {
    expect(validateFrlgStaticRequest(baseRequest())).toEqual([]);
  });

  it('matches the source planner Japanese restrictions', () => {
    expect(validateFrlgStaticRequest(baseRequest({ game: 'fr_jpn_nx', pokemon: 'Charmander' }))).toEqual([]);
    expect(validateFrlgStaticRequest(baseRequest({ game: 'fr_jpn_nx', pokemon: 'Eevee', category: 'Gift' }))).toContain('日版当前只支持静态御三家（妙蛙种子/小火龙/杰尼龟）');
    expect(validateFrlgStaticRequest(baseRequest({ game: 'fr_jpn_nx', seedMode: 1 }))).toContain('日版御三家当前只有 mono_h_a Seed 表，请选择自动或模式 0');
  });

  it('matches the source planner static whitelist and numeric bounds', () => {
    expect(validateFrlgStaticRequest(baseRequest({ game: 'fr_nx', category: 'GameCorner', pokemon: 'Pinsir' }))).toContain('2.0 不支持该版本的静态组合: GameCorner / Pinsir');
    expect(validateFrlgStaticRequest(baseRequest({ tid: 65536 }))).toContain('TID 必须在 0-65535 之间');
    expect(validateFrlgStaticRequest(baseRequest({ ivMin: [0, 0, 0, 8, 0, 0], ivMax: [31, 31, 31, 7, 31, 31] }))).toContain('每项个体值必须满足 0 <= 最小值 <= 最大值 <= 31');
    expect(validateFrlgStaticRequest(baseRequest({ method: 'Static 2', category: 'Roaming', pokemon: 'Raikou' }))).toContain('火红/叶绿游走兽不支持 Static 2，请使用 Static 1 或 Static 4');
  });

  it('maps the full original planner parameter names without leaking UI aliases', () => {
    const payload = toFrlgPlannerPayload(baseRequest({
      seedMode: 3,
      directMode: true,
      directSeed: '11C7',
      directAdvances: 42,
      initialSeedResultCount: 4,
      maxIvCombinations: 1234,
      hiddenType: 'Fire',
    }));
    expect(payload).toMatchObject({
      seed_mode: 3,
      direct_mode: true,
      direct_seed: '11C7',
      direct_advances: 42,
      initial_seed_result_count: 4,
      max_iv_combinations: 1234,
      hidden_type: 'Fire',
    });
    expect(payload).not.toHaveProperty('seedMode');
    expect(payload).not.toHaveProperty('directMode');
    expect(payload).not.toHaveProperty('initialSeedResultCount');
  });
});
