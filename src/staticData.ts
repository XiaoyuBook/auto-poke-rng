import data from './generated/bdsp-data.json';

export type StaticCategoryKey = 'all' | 'starters' | 'gifts' | 'fossils' | 'stationary' | 'roamers' | 'legends' | 'ramanasParkPureSpace' | 'ramanasParkStrangeSpace' | 'mythics';
export type StaticGameVersion = 'BD' | 'SP' | 'BDSP';
export const CATEGORY_OPTIONS: ReadonlyArray<{ key: StaticCategoryKey; label: string }> = [
  { key: 'starters', label: '御三家' }, { key: 'all', label: '全部' },
  { key: 'gifts', label: '赠送' }, { key: 'fossils', label: '化石' },
  { key: 'stationary', label: '定点' }, { key: 'roamers', label: '游走' },
  { key: 'legends', label: '传说' }, { key: 'ramanasParkPureSpace', label: '玫瑰公园（纯净空间）' },
  { key: 'ramanasParkStrangeSpace', label: '玫瑰公园（奇异空间）' }, { key: 'mythics', label: '幻兽' },
];
export type StaticTarget = Omit<typeof data.targets[number], 'category' | 'version'> & {
  category: Exclude<StaticCategoryKey, 'all'>;
  version: StaticGameVersion;
};
// The renderer and native adapter share generated, hash-verified upstream resources.
export const STATIC_TARGETS = data.targets as StaticTarget[];
export const NATURES_ZH = data.natures;
export const CHARACTERISTICS_ZH = data.characteristics;
export const ABILITIES_ZH = data.abilities;
export const CALCULATOR_SPECIES = data.calculatorSpecies;
export const HIDDEN_POWERS_ZH = data.hiddenPowers;
export const targetAbilityLabel = (ability: number) => ({ 0: '0', 1: '1', 2: '隐藏', 255: '0/1' }[ability] ?? String(ability));
export const targetShinyLabel = (shiny: number) => ({ 0: '随机', 1: '锁闪', 2: '异色', 3: 'Star', 4: 'Square' }[shiny] ?? String(shiny));
export function getStaticTargets(category: StaticCategoryKey = 'all', version: StaticGameVersion = 'BDSP'): StaticTarget[] {
  return STATIC_TARGETS.filter(target => (category === 'all' || target.category === category) &&
    (version === 'BDSP' || target.version === 'BDSP' || target.version === version));
}
export function getCategoryLabel(category: StaticCategoryKey): string {
  return CATEGORY_OPTIONS.find(option => option.key === category)!.label;
}
