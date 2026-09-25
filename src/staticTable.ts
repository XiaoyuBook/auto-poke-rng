import { useEffect, useState } from 'react';

export const STATIC_COLUMNS = [
  { id: 'advances', label: '帧数', width: 70 }, { id: 'ec', label: 'EC', width: 90 },
  { id: 'pid', label: 'PID', width: 90 }, { id: 'shiny', label: '异色', width: 64 },
  { id: 'nature', label: '性格', width: 78 }, { id: 'ability', label: '特性', width: 62 },
  { id: 'gender', label: '性别', width: 56 }, { id: 'hp', label: 'HP', width: 56 },
  { id: 'atk', label: '攻击', width: 56 }, { id: 'def', label: '防御', width: 56 },
  { id: 'spa', label: '特攻', width: 56 }, { id: 'spd', label: '特防', width: 56 },
  { id: 'spe', label: '速度', width: 56 }, { id: 'height', label: '身高', width: 62 },
  { id: 'weight', label: '体重', width: 62 }, { id: 'characteristic', label: '个性', width: 150 },
];
const key = 'auto-poke-rng:bdsp-static-hidden-columns';
export function useStaticColumns() {
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(saved)) return STATIC_COLUMNS.filter(column => column.id !== 'advances' && saved.includes(column.id)).map(column => column.id);
    } catch { /* Invalid storage restores all columns. */ }
    return [];
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(hidden)); } catch { /* The current table still responds when storage is unavailable. */ }
  }, [hidden]);
  return { hidden, setHidden, visible: STATIC_COLUMNS.map((column, index) => ({ ...column, index })).filter(column => !hidden.includes(column.id)) };
}
