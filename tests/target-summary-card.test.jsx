// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describeTargetFilter, TargetSummaryCard } from '../src/components/TargetSummaryCard';
import { NATURES_ZH, STATIC_TARGETS } from '../src/staticData';

const unrestricted = () => ({ skip: false, shiny: 255, ability: 255, gender: 255,
  ivMin: [0, 0, 0, 0, 0, 0], ivMax: [31, 31, 31, 31, 31, 31],
  natures: Array(25).fill(true), heightMin: 0, heightMax: 255, weightMin: 0, weightMax: 255 });

describe('automatic static target summary', () => {
  test('omits unrestricted attributes while preserving exact zeroes and ranges', () => {
    const filter = { ...unrestricted(), shiny: 2, ivMin: [0, 31, 0, 0, 0, 30],
      ivMax: [31, 31, 31, 31, 31, 31], heightMax: 0, weightMin: 0, weightMax: 0 };
    expect(describeTargetFilter(filter)).toEqual([
      { text: '方形闪光', shiny: true }, { text: '攻击 31' }, { text: '速度 30–31' },
      { text: '身高 0' }, { text: '体重 0' },
    ]);
  });
  test('distinguishes every shiny kind, partial nature sets, and skipped filtering', () => {
    expect(describeTargetFilter({ ...unrestricted(), shiny: 1 })[0]).toEqual({ text: '星形闪光', shiny: true });
    expect(describeTargetFilter({ ...unrestricted(), shiny: 3 })[0]).toEqual({ text: '异色', shiny: true });
    expect(describeTargetFilter({ ...unrestricted(), shiny: 0 })[0]).toEqual({ text: '非异色', shiny: false });
    const natures = Array(25).fill(false); natures[3] = true; natures[12] = true;
    const terms = describeTargetFilter({ ...unrestricted(), natures, gender: 0, ability: 2, ivMax: [31, 31, 31, 31, 31, 0] });
    expect(terms).toContainEqual({ text: `性格 ${NATURES_ZH[3]}、${NATURES_ZH[12]}` });
    expect(terms).toContainEqual({ text: '性别 雄性' });
    expect(terms).toContainEqual({ text: '速度 0' });
    expect(describeTargetFilter({ ...unrestricted(), skip: true, shiny: 2 })).toEqual([{ text: '不限条件' }]);
    expect(describeTargetFilter(unrestricted())).toEqual([{ text: '不限条件' }]);
  });
  test('keeps each OR group separate and permits full viewing while settings are locked', () => {
    let opens = 0;
    const filters = [
      { ...unrestricted(), shiny: 2, ivMin: [0, 31, 0, 0, 0, 0] },
      { ...unrestricted(), shiny: 1, ivMin: [0, 0, 0, 0, 0, 30] },
      { ...unrestricted(), shiny: 0, heightMin: 0, heightMax: 0 },
      unrestricted(),
    ];
    const { container } = render(<TargetSummaryCard target={STATIC_TARGETS[0]} filters={filters} locked onSettings={() => opens++} />);
    const rows = container.querySelectorAll('.automation-target-condition-list li');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('攻击 31')).toBeTruthy();
    expect(within(rows[0]).queryByText('速度 30–31')).toBeNull();
    expect(within(rows[1]).getByText('速度 30–31')).toBeTruthy();
    expect(within(rows[2]).getByText('身高 0')).toBeTruthy();
    expect(within(rows[0]).getByText('方形闪光').querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('button', { name: '目标设置' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '查看全部 4 组条件' }));
    expect(opens).toBe(1);
  });
});
