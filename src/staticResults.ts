import type { NativeStaticResult } from './desktop';
import { CHARACTERISTICS_ZH, NATURES_ZH } from './staticData';
import { STATIC_COLUMNS } from './staticTable';

// Display, export and keyboard lookup must use the same values and column order.
export function staticResultCell(row: NativeStaticResult, column: number, showStats: boolean): string | number {
  switch (column) {
    case 0: return row.advances;
    case 1: return row.ec;
    case 2: return row.pid;
    case 3: return ['否', 'Star', 'Square'][row.shiny];
    case 4: return NATURES_ZH[row.nature];
    case 5: return row.ability === 2 ? '隐藏' : String(row.ability);
    case 6: return ['雄', '雌', '-'][row.gender];
    case 13: return row.height;
    case 14: return row.weight;
    case 15: return CHARACTERISTICS_ZH[row.characteristic];
    default: return (showStats ? row.stats : row.ivs)[column - 7];
  }
}
export const staticResultCells = (row: NativeStaticResult, showStats: boolean) => STATIC_COLUMNS.map((_, index) => staticResultCell(row, index, showStats));

export const TABLE_ROW_HEIGHT = 36;
export const TABLE_HEADER_HEIGHT = 32;
export const TABLE_SEARCH_INTERVAL = 400;

export function findStaticResult(rows: NativeStaticResult[], column: number, text: string, start: number, showStats: boolean) {
  const prefix = text.toLocaleLowerCase();
  for (let offset = 0; offset < rows.length; offset++) {
    const index = (start + offset) % rows.length;
    if (String(staticResultCell(rows[index], column, showStats)).toLocaleLowerCase().startsWith(prefix)) return index;
  }
  return -1;
}
