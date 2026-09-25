/**
 * Verified BDSP static encounter metadata copied from auto-bdsp-rng's
 * StaticTargetForm and data modules.  Keep presentation labels here so the
 * workspace does not grow another, slightly different translation table.
 */

export type StaticCategoryKey =
  | 'all'
  | 'starters'
  | 'gifts'
  | 'fossils'
  | 'stationary'
  | 'roamers'
  | 'legends'
  | 'ramanasParkPureSpace'
  | 'ramanasParkStrangeSpace'
  | 'mythics';

export type StaticGameVersion = 'BD' | 'SP' | 'BDSP';
export type StaticShiny = '随机' | '锁闪' | 'Star' | 'Square';
export type StaticGenderMode = 'normal' | 'male' | 'female' | 'genderless';

export const CATEGORY_OPTIONS: ReadonlyArray<{ key: StaticCategoryKey; label: string }> = [
  { key: 'starters', label: '御三家' },
  { key: 'all', label: '全部' },
  { key: 'gifts', label: '赠送' },
  { key: 'fossils', label: '化石' },
  { key: 'stationary', label: '定点' },
  { key: 'roamers', label: '游走' },
  { key: 'legends', label: '传说' },
  { key: 'ramanasParkPureSpace', label: '玫瑰公园（纯净空间）' },
  { key: 'ramanasParkStrangeSpace', label: '玫瑰公园（奇异空间）' },
  { key: 'mythics', label: '幻兽' },
];

export const CATEGORY_LABELS_ZH: Readonly<Record<StaticCategoryKey, string>> = Object.fromEntries(
  CATEGORY_OPTIONS.map(option => [option.key, option.label]),
) as Record<StaticCategoryKey, string>;

export const POKEMON_LABELS_ZH: Readonly<Record<string, string>> = {
  Turtwig: '草苗龟',
  Chimchar: '小火焰猴',
  Piplup: '波加曼',
  Eevee: '伊布',
  'Happiny egg': '小福蛋蛋',
  'Riolu egg': '利欧路蛋',
  Omanyte: '菊石兽',
  Kabuto: '化石盔',
  Aerodactyl: '化石翼龙',
  Lileep: '触手百合',
  Anorith: '太古羽虫',
  Cranidos: '头盖龙',
  Shieldon: '盾甲龙',
  Drifloon: '飘飘球',
  Spiritomb: '花岩怪',
  Rotom: '洛托姆',
  Mespirit: '艾姆利多',
  Cresselia: '克雷色利亚',
  Uxie: '由克希',
  Azelf: '亚克诺姆',
  Dialga: '帝牙卢卡',
  Palkia: '帕路奇亚',
  Heatran: '席多蓝恩',
  Regigigas: '雷吉奇卡斯',
  Giratina: '骑拉帝纳',
  Articuno: '急冻鸟',
  Zapdos: '闪电鸟',
  Moltres: '火焰鸟',
  Raikou: '雷公',
  Entei: '炎帝',
  Suicune: '水君',
  Regirock: '雷吉洛克',
  Regice: '雷吉艾斯',
  Registeel: '雷吉斯奇鲁',
  Latias: '拉帝亚斯',
  Latios: '拉帝欧斯',
  Mewtwo: '超梦',
  Lugia: '洛奇亚',
  'Ho-Oh': '凤王',
  Kyogre: '盖欧卡',
  Groudon: '固拉多',
  Rayquaza: '烈空坐',
  Mew: '梦幻',
  Jirachi: '基拉祈',
  Darkrai: '达克莱伊',
  Shaymin: '谢米',
  Arceus: '阿尔宙斯',
};

export const NATURES_ZH = [
  '勤奋',
  '怕寂寞',
  '勇敢',
  '固执',
  '顽皮',
  '大胆',
  '坦率',
  '悠闲',
  '淘气',
  '乐天',
  '胆小',
  '急躁',
  '认真',
  '爽朗',
  '天真',
  '内敛',
  '慢吞吞',
  '冷静',
  '害羞',
  '马虎',
  '温和',
  '温顺',
  '自大',
  '慎重',
  '浮躁',
] as const;

/** Six characteristic groups, indexed by the highest IV stat. */
export const CHARACTERISTICS_ZH = [
  ['非常喜欢吃东西', '经常睡午觉', '常常打瞌睡', '经常乱扔东西', '喜欢悠然自在'],
  ['以力气大为傲', '喜欢胡闹', '有点容易生气', '喜欢打架', '血气方刚'],
  ['身体强壮', '抗打能力强', '顽强不屈', '能吃苦耐劳', '善于忍耐'],
  ['好奇心强', '喜欢恶作剧', '做事万无一失', '经常思考', '一丝不苟'],
  ['性格强势', '有一点点爱慕虚荣', '争强好胜', '不服输', '有一点点固执'],
  ['喜欢比谁跑得快', '对声音敏感', '冒冒失失', '有点容易得意忘形', '逃得快'],
] as const;

export type StaticTarget = {
  category: Exclude<StaticCategoryKey, 'all'>;
  speciesKey: string;
  species: string;
  version: StaticGameVersion;
  level: number;
  ability: '0' | '1' | '隐藏' | '0/1';
  shiny: StaticShiny;
  ivCount: number;
  fateful: boolean;
  roamer: boolean;
  genderMode: StaticGenderMode;
};

type StaticRow = [
  Exclude<StaticCategoryKey, 'all'>,
  string,
  StaticGameVersion,
  number,
  StaticShiny,
  StaticTarget['ability'],
  number,
  boolean,
  boolean,
];

// The order and values mirror _STATIC_TEMPLATE_ROWS and _level_for in the
// maintained auto-bdsp-rng source. BDSP means the encounter exists in both
// versions; BD and SP remain version-exclusive.
const STATIC_TEMPLATE_ROWS: ReadonlyArray<StaticRow> = [
  ['starters', 'Turtwig', 'BDSP', 5, '随机', '0/1', 0, false, false],
  ['starters', 'Chimchar', 'BDSP', 5, '随机', '0/1', 0, false, false],
  ['starters', 'Piplup', 'BDSP', 5, '随机', '0/1', 0, false, false],
  ['gifts', 'Eevee', 'BDSP', 5, '随机', '0/1', 0, false, false],
  ['gifts', 'Happiny egg', 'BDSP', 1, '随机', '0/1', 0, false, false],
  ['gifts', 'Riolu egg', 'BDSP', 1, '随机', '0/1', 0, false, false],
  ['fossils', 'Omanyte', 'BDSP', 1, '随机', '0/1', 3, false, false],
  ['fossils', 'Kabuto', 'BDSP', 1, '随机', '0/1', 3, false, false],
  ['fossils', 'Aerodactyl', 'BDSP', 1, '随机', '0/1', 3, false, false],
  ['fossils', 'Lileep', 'BDSP', 1, '随机', '0/1', 3, false, false],
  ['fossils', 'Anorith', 'BDSP', 1, '随机', '0/1', 3, false, false],
  ['fossils', 'Cranidos', 'BDSP', 1, '随机', '0/1', 3, false, false],
  ['fossils', 'Shieldon', 'BDSP', 1, '随机', '0/1', 3, false, false],
  ['stationary', 'Drifloon', 'BDSP', 22, '随机', '0/1', 3, false, false],
  ['stationary', 'Spiritomb', 'BDSP', 25, '随机', '0/1', 0, false, false],
  ['stationary', 'Rotom', 'BDSP', 15, '随机', '0/1', 0, false, false],
  ['roamers', 'Mespirit', 'BDSP', 50, '随机', '0/1', 3, false, true],
  ['roamers', 'Cresselia', 'BDSP', 50, '随机', '0/1', 3, false, true],
  ['legends', 'Uxie', 'BDSP', 50, '随机', '0/1', 3, false, false],
  ['legends', 'Azelf', 'BDSP', 50, '随机', '0/1', 3, false, false],
  ['legends', 'Dialga', 'BD', 47, '随机', '0/1', 3, false, false],
  ['legends', 'Palkia', 'SP', 47, '随机', '0/1', 3, false, false],
  ['legends', 'Heatran', 'BDSP', 70, '随机', '0/1', 3, false, false],
  ['legends', 'Regigigas', 'BDSP', 70, '随机', '0/1', 3, false, false],
  ['legends', 'Giratina', 'BDSP', 70, '随机', '0/1', 3, false, false],
  ['ramanasParkPureSpace', 'Articuno', 'SP', 70, '随机', '0/1', 3, false, false],
  ['ramanasParkPureSpace', 'Zapdos', 'SP', 70, '随机', '0/1', 3, false, false],
  ['ramanasParkPureSpace', 'Moltres', 'SP', 70, '随机', '0/1', 3, false, false],
  ['ramanasParkPureSpace', 'Raikou', 'BD', 70, '随机', '0/1', 3, false, false],
  ['ramanasParkPureSpace', 'Entei', 'BD', 70, '随机', '0/1', 3, false, false],
  ['ramanasParkPureSpace', 'Suicune', 'BD', 70, '随机', '0/1', 3, false, false],
  ['ramanasParkPureSpace', 'Regirock', 'BDSP', 70, '随机', '0/1', 3, false, false],
  ['ramanasParkPureSpace', 'Regice', 'BDSP', 70, '随机', '0/1', 3, false, false],
  ['ramanasParkPureSpace', 'Registeel', 'BDSP', 70, '随机', '0/1', 3, false, false],
  ['ramanasParkPureSpace', 'Latias', 'BDSP', 70, '随机', '0/1', 3, false, false],
  ['ramanasParkPureSpace', 'Latios', 'BDSP', 70, '随机', '0/1', 3, false, false],
  ['ramanasParkStrangeSpace', 'Mewtwo', 'BDSP', 70, '随机', '0/1', 3, false, false],
  ['ramanasParkStrangeSpace', 'Lugia', 'SP', 70, '随机', '0/1', 3, false, false],
  ['ramanasParkStrangeSpace', 'Ho-Oh', 'BD', 70, '随机', '0/1', 3, false, false],
  ['ramanasParkStrangeSpace', 'Kyogre', 'BDSP', 70, '随机', '0/1', 3, false, false],
  ['ramanasParkStrangeSpace', 'Groudon', 'BDSP', 70, '随机', '0/1', 3, false, false],
  ['ramanasParkStrangeSpace', 'Rayquaza', 'BDSP', 70, '随机', '0/1', 3, false, false],
  ['mythics', 'Mew', 'BDSP', 70, '锁闪', '1', 3, true, false],
  ['mythics', 'Jirachi', 'BDSP', 70, '锁闪', '1', 3, true, false],
  ['mythics', 'Darkrai', 'BDSP', 50, '随机', '0/1', 3, true, false],
  ['mythics', 'Shaymin', 'BDSP', 30, '随机', '0/1', 3, true, false],
  ['mythics', 'Arceus', 'BDSP', 80, '随机', '0/1', 3, true, false],
];

/** Gender ratios are read from PokeFinder's Gen8 personal table. */
const SPECIES_GENDER_MODES: Readonly<Record<string, StaticGenderMode>> = {
  'Happiny egg': 'female',
  Drifloon: 'normal',
  Spiritomb: 'normal',
  Rotom: 'genderless',
  Mespirit: 'genderless',
  Cresselia: 'female',
  Uxie: 'genderless',
  Azelf: 'genderless',
  Dialga: 'genderless',
  Palkia: 'genderless',
  Heatran: 'normal',
  Regigigas: 'genderless',
  Giratina: 'genderless',
  Articuno: 'genderless',
  Zapdos: 'genderless',
  Moltres: 'genderless',
  Raikou: 'genderless',
  Entei: 'genderless',
  Suicune: 'genderless',
  Regirock: 'genderless',
  Regice: 'genderless',
  Registeel: 'genderless',
  Latias: 'female',
  Latios: 'male',
  Mewtwo: 'genderless',
  Lugia: 'genderless',
  'Ho-Oh': 'genderless',
  Kyogre: 'genderless',
  Groudon: 'genderless',
  Rayquaza: 'genderless',
  Mew: 'genderless',
  Jirachi: 'genderless',
  Darkrai: 'genderless',
  Shaymin: 'genderless',
  Arceus: 'genderless',
};

function speciesGenderMode(speciesKey: string): StaticGenderMode {
  return SPECIES_GENDER_MODES[speciesKey] ?? 'normal';
}

export const STATIC_TARGETS: ReadonlyArray<StaticTarget> = STATIC_TEMPLATE_ROWS.map(
  ([category, speciesKey, version, level, shiny, ability, ivCount, fateful, roamer]) => ({
    category,
    speciesKey,
    species: POKEMON_LABELS_ZH[speciesKey] ?? speciesKey,
    version,
    level,
    ability,
    shiny,
    ivCount,
    fateful,
    roamer,
    genderMode: speciesGenderMode(speciesKey),
  }),
);

export function getStaticTargets(
  category: StaticCategoryKey = 'all',
  version: StaticGameVersion = 'BDSP',
): StaticTarget[] {
  return STATIC_TARGETS.filter(target =>
    (category === 'all' || target.category === category) &&
    (version === 'BDSP' || target.version === 'BDSP' || target.version === version),
  );
}

export function getCategoryLabel(category: StaticCategoryKey): string {
  return CATEGORY_LABELS_ZH[category];
}

export function getCharacteristic(statIndex: number, characteristicIndex: number): string {
  const statGroup = CHARACTERISTICS_ZH[Math.max(0, Math.min(CHARACTERISTICS_ZH.length - 1, statIndex))];
  return statGroup[Math.max(0, Math.min(statGroup.length - 1, characteristicIndex))];
}

/** Apply PokeFinder's EC tie-break order to obtain the displayed characteristic. */
export function getCharacteristicForState(ec: number, ivs: ReadonlyArray<number>): string {
  const order = [0, 1, 2, 5, 3, 4];
  const charOrder = [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4];
  const ecIndex = Math.abs(ec) % 6;
  let characteristicIndex = ecIndex;
  let maxIv = 0;
  for (let offset = 0; offset < 6; offset += 1) {
    const index = charOrder[ecIndex + offset];
    const statIndex = order[index];
    if ((ivs[statIndex] ?? 0) > maxIv) {
      characteristicIndex = index;
      maxIv = ivs[statIndex] ?? 0;
    }
  }
  return getCharacteristic(order[characteristicIndex], maxIv % 5);
}
