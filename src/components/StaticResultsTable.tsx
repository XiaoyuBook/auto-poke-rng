import { useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { NativeStaticResult } from '../desktop';
import { ABILITIES_ZH } from '../staticData';
import { findStaticResult, staticResultCell, TABLE_HEADER_HEIGHT, TABLE_ROW_HEIGHT, TABLE_SEARCH_INTERVAL } from '../staticResults';

type Column = { id: string; label: string; width: number; index: number };
const OVERSCAN = 8;

export function StaticResultsTable({ rows, columns, showStats, selectedIndex, onSelect, onSearchStatus, children }: {
  rows: NativeStaticResult[]; columns: Column[]; showStats: boolean; selectedIndex: number | null;
  onSelect: (index: number) => void; onSearchStatus: (message: string) => void; children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLTableElement>(null);
  const [range, setRange] = useState({ start: 0, end: 24 });
  const [columnId, setColumnId] = useState('advances');
  const column = columns.find(item => item.id === columnId) ?? columns[0];
  const search = useRef({ text: '', time: -Infinity });
  const revealColumn = useRef(false);
  const id = useId();
  const columnKey = columns.map(item => item.id).join(',');
  const start = Math.min(range.start, Math.max(0, rows.length - 1));
  const end = Math.min(rows.length, Math.max(start + 1, range.end));
  const selectedVisible = selectedIndex !== null && selectedIndex >= start && selectedIndex < end;
  const cellId = (row: number, index: number) => `${id}-cell-${row}-${index}`;

  const resetSearch = useCallback(() => {
    search.current = { text: '', time: -Infinity };
    onSearchStatus('');
  }, [onSearchStatus]);
  const measure = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    const height = element.clientHeight || 320;
    const first = Math.max(0, Math.floor(element.scrollTop / TABLE_ROW_HEIGHT) - OVERSCAN);
    const last = Math.ceil((element.scrollTop + height - TABLE_HEADER_HEIGHT) / TABLE_ROW_HEIGHT) + OVERSCAN;
    setRange(previous => previous.start === first && previous.end === last ? previous : { start: first, end: last });
  }, []);
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport.current!);
    return () => observer.disconnect();
  }, [measure]);
  useLayoutEffect(() => {
    viewport.current!.scrollTop = 0;
    measure();
    resetSearch();
  }, [rows, measure, resetSearch]);
  useLayoutEffect(() => {
    resetSearch();
    if (!columns.some(item => item.id === columnId)) setColumnId(columns[0].id);
    // Column IDs, not the freshly allocated array, determine a schema change.
  }, [columnKey, showStats, resetSearch]);
  useLayoutEffect(() => {
    if (!revealColumn.current) return;
    revealColumn.current = false;
    const element = viewport.current!;
    const header = grid.current?.querySelector<HTMLElement>(`th[data-column="${column.id}"]`);
    if (!header) return;
    const bounds = element.getBoundingClientRect();
    const cell = header.getBoundingClientRect();
    const left = bounds.left + element.clientLeft;
    const right = left + element.clientWidth;
    if (cell.left < left) element.scrollLeft += cell.left - left;
    else if (cell.right > right) element.scrollLeft += cell.right - right;
  });

  const select = (index: number, nextColumn = column) => {
    setColumnId(nextColumn.id);
    onSelect(index);
    const element = viewport.current!;
    const top = index * TABLE_ROW_HEIGHT;
    const available = Math.max(TABLE_ROW_HEIGHT, (element.clientHeight || 320) - TABLE_HEADER_HEIGHT);
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + TABLE_ROW_HEIGHT > element.scrollTop + available) element.scrollTop = top + TABLE_ROW_HEIGHT - available;
    revealColumn.current = true;
    measure();
    grid.current?.focus({ preventScroll: true });
  };
  const lookup = (text: string, fresh: boolean) => {
    const from = selectedIndex === null ? 0 : (selectedIndex + (fresh ? 1 : 0)) % rows.length;
    const match = findStaticResult(rows, column.index, text, from, showStats);
    onSearchStatus(`${column.label}：${text} · ${match < 0 ? '未找到匹配项' : `第 ${match + 1} 条`}`);
    if (match >= 0) select(match);
  };
  const keyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    if (!rows.length || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
      (event.target as HTMLElement).closest('button,input,select,textarea')) return;
    const index = selectedIndex ?? 0;
    const columnIndex = columns.findIndex(item => item.id === column.id);
    const pageSize = Math.max(1, Math.floor(((viewport.current?.clientHeight || 320) - TABLE_HEADER_HEIGHT) / TABLE_ROW_HEIGHT));
    let nextRow = index;
    let nextColumn = columnIndex;
    switch (event.key) {
      case 'ArrowUp': nextRow--; break;
      case 'ArrowDown': nextRow += selectedIndex === null ? 0 : 1; break;
      case 'ArrowLeft': nextColumn--; break;
      case 'ArrowRight': nextColumn++; break;
      case 'Home': nextRow = 0; break;
      case 'End': nextRow = rows.length - 1; break;
      case 'PageUp': nextRow -= pageSize; break;
      case 'PageDown': nextRow += pageSize; break;
      case 'Escape': resetSearch(); event.preventDefault(); event.stopPropagation(); return;
      case 'Backspace': {
        event.preventDefault(); event.stopPropagation();
        const text = search.current.text.slice(0, -1);
        search.current = { text, time: performance.now() };
        if (text) lookup(text, false); else resetSearch();
        return;
      }
      default: {
        if (event.key.length !== 1) return;
        event.preventDefault(); event.stopPropagation();
        const time = performance.now();
        const fresh = time - search.current.time > TABLE_SEARCH_INTERVAL || !search.current.text;
        const text = fresh ? event.key : search.current.text + event.key;
        search.current = { text, time };
        lookup(text, fresh);
        return;
      }
    }
    event.preventDefault(); event.stopPropagation(); resetSearch();
    select(Math.max(0, Math.min(rows.length - 1, nextRow)), columns[Math.max(0, Math.min(columns.length - 1, nextColumn))]);
  };

  return <div ref={viewport} className="static-table-wrap" onScroll={measure}>
    <table ref={grid} className="static-table" role="grid" aria-label="定点结果表" tabIndex={0}
      aria-rowcount={rows.length + 1} aria-colcount={columns.length}
      aria-activedescendant={selectedVisible ? cellId(selectedIndex!, column.index) : undefined}
      aria-description="点击单元格后直接输入，可在该列全部结果中快速定位。方向键移动，Home 和 End 跳到首尾。"
      style={{ minWidth: columns.reduce((sum, item) => sum + item.width, 0), '--static-row-height': `${TABLE_ROW_HEIGHT}px`, '--static-header-height': `${TABLE_HEADER_HEIGHT}px` } as CSSProperties}
      onKeyDown={keyDown} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) resetSearch(); }}>
      <colgroup>{columns.map(item => <col key={item.id} style={{ width: item.width }} />)}</colgroup>
      <thead><tr aria-rowindex={1}>{columns.map(item => <th key={item.id} data-column={item.id} scope="col">{item.label}</th>)}</tr></thead>
      <tbody>{rows.length ? <>
        {start > 0 && <tr className="static-table-spacer" aria-hidden="true"><td colSpan={columns.length} style={{ height: start * TABLE_ROW_HEIGHT }} /></tr>}
        {rows.slice(start, end).map((row, offset) => {
          const index = start + offset;
          return <tr key={index} data-row-index={index} aria-rowindex={index + 2} aria-selected={index === selectedIndex} className={index === selectedIndex ? 'is-selected' : undefined}>
            {columns.map(item => <td key={item.id} id={cellId(index, item.index)} role="gridcell" data-column={item.id}
              aria-selected={index === selectedIndex && item.id === column.id}
              title={item.index === 5 ? ABILITIES_ZH[row.abilityIndex - 1] : undefined}
              className={[item.index < 3 || item.index > 6 && item.index < 15 ? 'mono' : '', index === selectedIndex && item.id === column.id ? 'is-current' : ''].filter(Boolean).join(' ') || undefined}
              onClick={() => { resetSearch(); select(index, item); }}>{staticResultCell(row, item.index, showStats)}</td>)}
          </tr>;
        })}
        {end < rows.length && <tr className="static-table-spacer" aria-hidden="true"><td colSpan={columns.length} style={{ height: (rows.length - end) * TABLE_ROW_HEIGHT }} /></tr>}
      </> : <tr><td role="gridcell" className="static-empty" colSpan={columns.length}>{children}</td></tr>}</tbody>
    </table>
  </div>;
}
