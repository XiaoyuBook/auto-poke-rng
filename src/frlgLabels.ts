import { FRLG_ABILITY_LABELS, FRLG_NATURE_LABELS, FRLG_TYPE_LABELS } from './frlgMetadata';

export const gameLabels: Record<string, string> = {
  fr_nx: '火红 · 美版 · Switch 1', fr_nx2: '火红 · 美版 · Switch 2',
  lg_nx: '叶绿 · 美版 · Switch 1', lg_nx2: '叶绿 · 美版 · Switch 2',
  fr_jpn_nx: '火红 · 日版 · Switch 1', fr_jpn_nx2: '火红 · 日版 · Switch 2',
  lg_jpn_nx: '叶绿 · 日版 · Switch 1', lg_jpn_nx2: '叶绿 · 日版 · Switch 2',
};
export const categoryLabels: Record<string, string> = {
  Starter: '御三家', Fossil: '化石', Gift: '赠送', GameCorner: '游戏中心',
  Stationary: '定点', Legend: '传说', Event: '事件', Roaming: '游走',
  Grass: '草丛', Surfing: '冲浪', OldRod: '破旧钓竿', GoodRod: '好钓竿', SuperRod: '厉害钓竿', RockSmash: '碎岩',
};
export const methodLabels: Record<string, string> = {
  Static: 'Static', 'Static 1': 'Static 1', 'Static 2': 'Static 2', 'Static 4': 'Static 4',
  Wild: 'Wild', 'Wild 1': 'Wild 1', 'Wild 2': 'Wild 2', 'Wild 4': 'Wild 4', 'All Wild Methods': '全部野生方法',
};
export const statLabels = ['HP', '攻击', '防御', '特攻', '特防', '速度'];
export const natureLabels: Record<string, string> = FRLG_NATURE_LABELS;
export const abilityLabels: Record<string, string> = FRLG_ABILITY_LABELS;
export const typeLabels: Record<string, string> = FRLG_TYPE_LABELS;
export const shinyLabels: Record<string, string> = { None: '非闪光', Star: '星形闪光', Square: '方形闪光', 'Star/Square': '星形／方形闪光' };
