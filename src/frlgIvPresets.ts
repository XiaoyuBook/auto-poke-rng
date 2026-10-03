export const FRLG_IV_PRESETS = [
  { label: '不限', min: [0,0,0,0,0,0], max: [31,31,31,31,31,31], description: '六项个体值均为 0–31' },
  { label: '6V', min: [31,31,31,31,31,31], max: [31,31,31,31,31,31], description: '六项个体值均为 31' },
  { label: '0A', min: [31,0,31,31,31,31], max: [31,0,31,31,31,31], description: '攻击为 0，其余五项为 31' },
  { label: '0S', min: [31,31,31,31,31,0], max: [31,31,31,31,31,0], description: '速度为 0，其余五项为 31' },
  { label: '0A0S', min: [31,0,31,31,31,0], max: [31,0,31,31,31,0], description: '攻击和速度为 0，其余四项为 31' },
] as const;

export type FrlgIvPreset = typeof FRLG_IV_PRESETS[number];
