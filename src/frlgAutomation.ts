export const FRLG_GAMES = ['fr_nx', 'fr_nx2', 'lg_nx', 'lg_nx2', 'fr_jpn_nx', 'fr_jpn_nx2', 'lg_jpn_nx', 'lg_jpn_nx2'] as const;
export type FrlgGame = typeof FRLG_GAMES[number];

export const FRLG_STATIC_CATEGORIES = ['Starter', 'Fossil', 'Gift', 'GameCorner', 'Stationary', 'Legend', 'Event', 'Roaming'] as const;
export type FrlgStaticCategory = typeof FRLG_STATIC_CATEGORIES[number];
export const FRLG_STATIC_METHODS = ['Static', 'Static 1', 'Static 2', 'Static 4'] as const;
export type FrlgStaticMethod = typeof FRLG_STATIC_METHODS[number];
export const FRLG_NATURES = [
  'Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty', 'Bold', 'Docile', 'Relaxed', 'Impish', 'Lax',
  'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive', 'Modest', 'Mild', 'Quiet', 'Bashful', 'Rash',
  'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky',
] as const;
export const FRLG_SHININESS = ['None', 'Star', 'Square', 'Star/Square'] as const;
export const FRLG_HIDDEN_TYPES = [
  'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass',
  'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark',
] as const;

export type FrlgStaticTarget = {
  species: string;
  speciesId: number;
  displayName: string;
  category: FrlgStaticCategory;
};

const species = (category: FrlgStaticCategory, speciesName: string, speciesId: number, displayName: string): FrlgStaticTarget => ({
  species: speciesName, speciesId, displayName, category,
});

const commonTargets: Record<Exclude<FrlgStaticCategory, 'GameCorner'>, readonly FrlgStaticTarget[]> = {
  Starter: [species('Starter', 'Bulbasaur', 1, '妙蛙种子'), species('Starter', 'Charmander', 4, '小火龙'), species('Starter', 'Squirtle', 7, '杰尼龟')],
  Fossil: [species('Fossil', 'Omanyte', 138, '菊石兽'), species('Fossil', 'Kabuto', 140, '化石盔'), species('Fossil', 'Aerodactyl', 142, '化石翼龙')],
  Gift: [species('Gift', 'Hitmonlee', 106, '飞腿郎'), species('Gift', 'Hitmonchan', 107, '快拳郎'), species('Gift', 'Magikarp', 129, '鲤鱼王'), species('Gift', 'Lapras', 131, '拉普拉斯'), species('Gift', 'Eevee', 133, '伊布'), species('Gift', 'Togepi', 175, '波克比')],
  Stationary: [species('Stationary', 'Hypno', 97, '催眠貘'), species('Stationary', 'Electrode', 101, '顽皮雷弹'), species('Stationary', 'Snorlax', 143, '卡比兽')],
  Legend: [species('Legend', 'Articuno', 144, '急冻鸟'), species('Legend', 'Zapdos', 145, '闪电鸟'), species('Legend', 'Moltres', 146, '火焰鸟'), species('Legend', 'Mewtwo', 150, '超梦')],
  Event: [species('Event', 'Lugia', 249, '洛奇亚'), species('Event', 'Ho-Oh', 250, '凤王'), species('Event', 'Deoxys', 386, '代欧奇希斯')],
  Roaming: [species('Roaming', 'Raikou', 243, '雷公'), species('Roaming', 'Entei', 244, '炎帝'), species('Roaming', 'Suicune', 245, '水君')],
};

const gameCornerTargets = {
  fr: [species('GameCorner', 'Abra', 63, '凯西'), species('GameCorner', 'Clefairy', 35, '皮皮'), species('GameCorner', 'Scyther', 123, '飞天螳螂'), species('GameCorner', 'Dratini', 147, '迷你龙'), species('GameCorner', 'Porygon', 137, '多边兽')],
  lg: [species('GameCorner', 'Abra', 63, '凯西'), species('GameCorner', 'Clefairy', 35, '皮皮'), species('GameCorner', 'Pinsir', 127, '凯罗斯'), species('GameCorner', 'Dratini', 147, '迷你龙'), species('GameCorner', 'Porygon', 137, '多边兽')],
} as const;

const gameFamily = (game: string): 'fr' | 'lg' | null => {
  const normalized = (game || '').toLowerCase();
  if (normalized.startsWith('fr')) return 'fr';
  if (normalized.startsWith('lg')) return 'lg';
  return null;
};

export const getFrlgStaticTargets = (game: string, category: FrlgStaticCategory | 'all' = 'all'): FrlgStaticTarget[] => {
  const family = gameFamily(game);
  if (!family) return [];
  const targets = [...FRLG_STATIC_CATEGORIES].flatMap(key => key === 'GameCorner' ? gameCornerTargets[family] : commonTargets[key]);
  return category === 'all' ? targets : targets.filter(target => target.category === category);
};

// The original planner's FireRed table is the canonical metadata snapshot for
// the renderer.  Version-specific differences are returned by the function above.
export const FRLG_STATIC_TARGETS = getFrlgStaticTargets('fr_nx');

export type FrlgRngMethod = FrlgStaticMethod | 'Wild' | 'Wild 1' | 'Wild 2' | 'Wild 4' | 'All Wild Methods';
export type FrlgStaticRequest = {
  game: string; tid: number; sid: number; method: FrlgRngMethod; category: string; location: string; pokemon: string;
  maxAdvances: number; minAdvances: number; ivMin: number[]; ivMax: number[];
  shiny: 'Any' | typeof FRLG_SHININESS[number]; nature: 'Any' | typeof FRLG_NATURES[number]; gender: 'Any' | 'M' | 'F' | '-';
  ability: string; hiddenType: 'Any' | typeof FRLG_HIDDEN_TYPES[number]; initialSeedResultCount: number; maxIvCombinations: number;
  seedMode: number | null; directMode: boolean; directSeed: string; directAdvances: number | null;
};

const error = (message: string) => message;
const staticSpecies = new Map(FRLG_STATIC_TARGETS.concat(getFrlgStaticTargets('lg_nx', 'GameCorner')).map(target => [target.species, target.speciesId]));

export function validateFrlgStaticRequest(request: FrlgStaticRequest): string[] {
  const errors: string[] = [];
  if (!FRLG_GAMES.includes(request.game as FrlgGame)) errors.push(`首版只支持火红/叶绿 Switch 1/2，当前游戏为 '${request.game}'`);
  if (!Number.isInteger(request.tid) || request.tid < 0 || request.tid > 65535) errors.push(error('TID 必须在 0-65535 之间'));
  if (!Number.isInteger(request.sid) || request.sid < 0 || request.sid > 65535) errors.push(error('SID 必须在 0-65535 之间'));
  const japanese = request.game.includes('_jpn_');
  if (japanese && (request.method !== 'Static 1' || request.category !== 'Starter' || !['Bulbasaur', 'Charmander', 'Squirtle'].includes(request.pokemon))) {
    errors.push('日版当前只支持静态御三家（妙蛙种子/小火龙/杰尼龟）');
  }
  if (request.minAdvances < 0) errors.push('最小 Advance 不能为负数');
  if (request.maxAdvances < 0) errors.push('最大 Advance 不能为负数');
  if (!request.directMode && request.minAdvances > request.maxAdvances) errors.push('最小 Advance 不能大于最大 Advance');
  if (request.initialSeedResultCount <= 0) errors.push('初始 Seed 候选数必须大于 0');
  if (request.maxIvCombinations <= 0) errors.push('搜索工作量上限必须大于 0');
  if (request.seedMode !== null && (!Number.isInteger(request.seedMode) || request.seedMode < 0 || request.seedMode > 9)) errors.push('Seed 模式必须在 0-9 之间');
  if (japanese && request.seedMode !== null && request.seedMode !== 0) errors.push('日版御三家当前只有 mono_h_a Seed 表，请选择自动或模式 0');
  if (request.ivMin.length !== 6 || request.ivMax.length !== 6 || request.ivMin.some((lo, index) => !Number.isInteger(lo) || !Number.isInteger(request.ivMax[index]) || lo < 0 || request.ivMax[index] < lo || request.ivMax[index] > 31)) {
    errors.push('每项个体值必须满足 0 <= 最小值 <= 最大值 <= 31');
  }
  if (!FRLG_STATIC_METHODS.includes(request.method as FrlgStaticMethod) && !['Wild', 'Wild 1', 'Wild 2', 'Wild 4', 'All Wild Methods'].includes(request.method)) errors.push(`不支持的 Ten Lines 方法: ${request.method}`);
  if (!(request.shiny === 'Any' || FRLG_SHININESS.includes(request.shiny as typeof FRLG_SHININESS[number]))) errors.push(`不支持的闪光筛选: ${request.shiny}`);
  if (!(request.nature === 'Any' || FRLG_NATURES.includes(request.nature as typeof FRLG_NATURES[number]))) errors.push(`不支持的性格筛选: ${request.nature}`);
  if (!['Any', 'M', 'F', '-'].includes(request.gender)) errors.push(`不支持的性别筛选: ${request.gender}`);
  if (!(request.hiddenType === 'Any' || FRLG_HIDDEN_TYPES.includes(request.hiddenType as typeof FRLG_HIDDEN_TYPES[number]))) errors.push(`不支持的隐藏属性筛选: ${request.hiddenType}`);
  const speciesId = staticSpecies.get(request.pokemon);
  if (!speciesId || speciesId < 1 || speciesId > 386) errors.push('全国图鉴编号必须在 1-386 之间');
  if (request.method.startsWith('Wild') || request.method === 'All Wild Methods') {
    if (!request.location) errors.push('野生搜索必须选择遭遇地点');
  } else if (request.category === 'Roaming' && !request.directMode) {
    if (request.method === 'Static 2') errors.push('火红/叶绿游走兽不支持 Static 2，请使用 Static 1 或 Static 4');
    if (!['Star', 'Square', 'Star/Square'].includes(request.shiny)) errors.push('游走搜索必须选择星形闪光、方形闪光或星形/方形闪光');
    if (request.ivMin[1] > 7) errors.push('游走兽的攻击个体值只能是 0-7，请降低攻击最低值');
    if (request.ivMin.slice(2).some(value => value > 0)) errors.push('游走兽的防御、特攻、特防和速度个体值固定为 0');
  }
  if (!request.method.includes('Wild') && !getFrlgStaticTargets(request.game, request.category as FrlgStaticCategory).some(target => target.species === request.pokemon)) {
    errors.push(`2.0 不支持该版本的静态组合: ${request.category} / ${request.pokemon}`);
  }
  if (request.directMode) {
    const raw = (request.directSeed || '').trim().toUpperCase().replace(/^0X/, '');
    if (!raw || raw.length > 8 || !/^[0-9A-F]+$/.test(raw) || Number.parseInt(raw, 16) > 0xffff) errors.push('指定 Seed 必须在 0000-FFFF 范围内');
    if (request.directAdvances === null || request.directAdvances < 0) errors.push('指定消耗帧必须为非负整数');
  }
  return errors;
}

export const defaultFrlgStaticRequest = (): FrlgStaticRequest => ({
  game: 'fr_nx', tid: 0, sid: 0, method: 'Static 1', category: 'Starter', pokemon: 'Bulbasaur', location: '',
  maxAdvances: 10000, minAdvances: 0, ivMin: [0, 0, 0, 0, 0, 0], ivMax: [31, 31, 31, 31, 31, 31],
  shiny: 'Star/Square', nature: 'Any', gender: 'Any', ability: 'Any', hiddenType: 'Any', initialSeedResultCount: 1,
  maxIvCombinations: 25_000_000, seedMode: null, directMode: false, directSeed: '', directAdvances: null,
});

export const toFrlgPlannerPayload = (request: FrlgStaticRequest) => {
  const {
    minAdvances, maxAdvances, ivMin, ivMax, initialSeedResultCount,
    maxIvCombinations, seedMode, directMode, directSeed, directAdvances,
    hiddenType, ...plannerFields
  } = request;
  return {
    ...plannerFields,
    min_advances: minAdvances,
    max_advances: maxAdvances,
    iv_min: ivMin,
    iv_max: ivMax,
    initial_seed_result_count: initialSeedResultCount,
    max_iv_combinations: maxIvCombinations,
    seed_mode: seedMode,
    direct_mode: directMode,
    direct_seed: directSeed || null,
    direct_advances: directAdvances,
    hidden_type: hiddenType,
  };
};
