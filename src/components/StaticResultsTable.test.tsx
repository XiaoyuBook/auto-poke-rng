// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NativeStaticResult } from '../desktop';
import { STATIC_COLUMNS } from '../staticTable';
import { StaticResultsTable } from './StaticResultsTable';

const base: NativeStaticResult = { advances: 0, ec: '220345D0', pid: '2203506A', ivs: [4,23,15,30,19,26], stats: [20,12,12,11,12,8], ability: 0, abilityIndex: 65, gender: 0, level: 5, nature: 22, shiny: 0, height: 10, weight: 99, characteristic: 20 };
const fixture = (count = 1500) => Array.from({ length: count }, (_, index) => ({ ...base, advances: index * 2 }));
let now = 0;
let resize!: () => void;
beforeEach(() => {
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Harness({ initial }: { initial: NativeStaticResult[] }) {
  const [rows, setRows] = useState(initial);
  const [selected, setSelected] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);
  const [stats, setStats] = useState(false);
  const [status, setStatus] = useState('');
  return <><button onClick={() => setHidden(value => !value)}>隐藏 EC</button><button onClick={() => setStats(value => !value)}>切换能力值</button>
    <button onClick={() => { setRows([base]); setSelected(null); }}>新结果</button><p role="status">{status}</p>
    <StaticResultsTable rows={rows} columns={STATIC_COLUMNS.map((column, index) => ({ ...column, index })).filter(column => !hidden || column.id !== 'ec')} showStats={stats} selectedIndex={selected} onSelect={setSelected} onSearchStatus={setStatus}>空结果</StaticResultsTable>
  </>;
}
const cell = (index: number, column: string) => document.querySelector<HTMLElement>(`[data-row-index="${index}"] [data-column="${column}"]`)!;
const current = () => document.querySelector<HTMLElement>('td.is-current')!;
const selectedRow = () => Number(current()?.parentElement?.getAttribute('data-row-index'));
const key = (value: string, elapsed = 40) => { now += elapsed; fireEvent.keyDown(screen.getByRole('grid'), { key: value }); };

it('rapid typing searches the entire selected column, wraps, and leaves selection unchanged on no match', () => {
  const rows = fixture(); rows[2].height = 20; rows[250].height = 250; rows[1200].height = 255; rows[13].height = 5; rows[50].height = 55;
  render(<Harness initial={rows} />);
  fireEvent.click(cell(0, 'height'));
  expect(document.activeElement).toBe(screen.getByRole('grid'));
  key('2'); expect(selectedRow()).toBe(2);
  key('5'); expect(selectedRow()).toBe(250);
  key('5'); expect(selectedRow()).toBe(1200); expect(current().textContent).toBe('255');
  expect(screen.getByRole('status').textContent).toContain('身高：255');
  expect(document.querySelectorAll('[data-row-index]').length).toBeLessThan(40);
  expect(Number((document.querySelector('.static-table-wrap') as HTMLElement).scrollTop)).toBeGreaterThan(40000);
  expect(screen.getByRole('grid').getAttribute('aria-activedescendant')).toBe(current().id);
  key('9'); expect(selectedRow()).toBe(1200); expect(screen.getByRole('status').textContent).toContain('未找到');
  key('5', 401); expect(selectedRow()).toBe(13);
  key('5', 401); expect(selectedRow()).toBe(50);
  key('Backspace'); expect(screen.getByRole('status').textContent).toBe('');
});
it('clicking a new cell and leaving the table reset the prefix; hex lookup ignores letter case', () => {
  const rows = fixture(); rows[900].ec = 'BEEF1234'; rows[901].ec = 'B0FF1234'; rows[901].weight = 255;
  render(<Harness initial={rows} />);
  fireEvent.click(cell(0, 'ec'));
  key('b'); expect(selectedRow()).toBe(900);
  key('e'); expect(selectedRow()).toBe(900);
  fireEvent.click(cell(900, 'weight'));
  key('2'); key('5'); key('5'); expect(selectedRow()).toBe(901); expect(current().dataset.column).toBe('weight');
  fireEvent.click(cell(901, 'ec')); key('b'); expect(selectedRow()).toBe(900);
  fireEvent.blur(screen.getByRole('grid'));
  key('b'); expect(selectedRow()).toBe(901);
});
it('search follows displayed IV or stat values and retains original column identity when others are hidden', () => {
  const rows = fixture(); rows[800].ivs = [31,1,1,1,1,1]; rows[800].stats = [145,1,1,1,1,1];
  render(<Harness initial={rows} />);
  fireEvent.click(cell(0, 'hp')); key('3'); key('1'); expect(selectedRow()).toBe(800);
  fireEvent.click(screen.getByRole('button', { name: '切换能力值' }));
  expect(current().textContent).toBe('145');
  fireEvent.click(screen.getByRole('button', { name: '隐藏 EC' }));
  fireEvent.click(current()); key('1'); key('4'); key('5'); expect(selectedRow()).toBe(800);
  expect(current().dataset.column).toBe('hp');
  key('ArrowLeft'); expect(current().dataset.column).toBe('gender');
  key('Home'); expect(selectedRow()).toBe(0);
  key('ArrowLeft'); key('ArrowLeft'); key('ArrowLeft'); key('ArrowLeft');
  expect(current().dataset.column).toBe('pid');
  key('ArrowLeft'); expect(current().dataset.column).toBe('advances');
});
it('100,000 rows support continuous scrolling, resize, keyboard ends and reset without mounting the whole table', () => {
  render(<Harness initial={fixture(100000)} />);
  const viewport = document.querySelector<HTMLElement>('.static-table-wrap')!;
  fireEvent.scroll(viewport, { target: { scrollTop: 70000 * 36 } });
  expect(cell(70000, 'advances').textContent).toBe('140000');
  expect(document.querySelectorAll('[data-row-index]').length).toBeLessThan(40);
  fireEvent.click(cell(70000, 'advances'));
  const before = document.querySelectorAll('[data-row-index]').length;
  Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 900 });
  act(() => resize());
  expect(document.querySelectorAll('[data-row-index]').length).toBeGreaterThan(before);
  key('End'); expect(selectedRow()).toBe(99999); expect(current().textContent).toBe('199998');
  key('ArrowDown'); expect(selectedRow()).toBe(99999);
  key('Home'); expect(selectedRow()).toBe(0);
  key('PageDown'); expect(selectedRow()).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: '新结果' }));
  expect(viewport.scrollTop).toBe(0);
  expect(document.querySelectorAll('[data-row-index]').length).toBe(1);
  expect(document.querySelector('td.is-current')).toBeNull();
});
it('lookup stays local to the table while modifier shortcuts and composition are left alone', () => {
  render(<Harness initial={fixture(10)} />);
  fireEvent.click(cell(0, 'ec'));
  const listener = vi.fn(); window.addEventListener('keydown', listener);
  try {
    key('a'); expect(listener).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'k', ctrlKey: true });
    expect(listener).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'e', isComposing: true });
    expect(screen.getByRole('status').textContent).toContain('EC：a');
    key('Escape'); expect(screen.getByRole('status').textContent).toBe('');
  } finally { window.removeEventListener('keydown', listener); }
});
