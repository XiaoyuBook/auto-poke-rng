// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FrlgHomeWorkspace } from './FrlgHomeWorkspace';
import { useFrlgSaves } from '../frlgProfile';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Home() {
  const saves = useFrlgSaves();
  return <FrlgHomeWorkspace saves={saves} onOpenAutomation={vi.fn()} />;
}

it('keeps fireleaf save slots independent when saving and switching profiles', () => {
  render(<Home />);
  fireEvent.change(screen.getByLabelText('火叶存档名称'), { target: { value: '火红主线' } });
  fireEvent.change(screen.getByLabelText('火叶存档 TID'), { target: { value: '12345' } });
  fireEvent.change(screen.getByLabelText('火叶存档 SID'), { target: { value: '54321' } });
  fireEvent.click(screen.getByLabelText('已完成全国图鉴'));
  fireEvent.click(screen.getByRole('button', { name: '保存当前存档' }));
  expect(document.querySelector('.frlg-save-feedback')?.textContent).toContain('当前存档已保存');

  fireEvent.click(screen.getByRole('button', { name: '新建存档' }));
  const selector = screen.getByLabelText('当前火叶存档') as HTMLSelectElement;
  expect(selector.options).toHaveLength(2);
  expect((screen.getByLabelText('火叶存档名称') as HTMLInputElement).value).toBe('火叶存档 2');
  expect((screen.getByLabelText('火叶存档 TID') as HTMLInputElement).value).toBe('0');
  fireEvent.change(screen.getByLabelText('火叶存档名称'), { target: { value: '叶绿支线' } });
  fireEvent.click(screen.getByRole('button', { name: '保存当前存档' }));

  fireEvent.change(selector, { target: { value: 'frlg-save-1' } });
  expect((screen.getByLabelText('火叶存档名称') as HTMLInputElement).value).toBe('火红主线');
  expect((screen.getByLabelText('火叶存档 TID') as HTMLInputElement).value).toBe('12345');
  expect((screen.getByLabelText('已完成全国图鉴') as HTMLInputElement).checked).toBe(true);
});
