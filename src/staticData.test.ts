import { describe, expect, it } from 'vitest';
import { CATEGORY_OPTIONS, NATURES_ZH, getStaticTargets } from './staticData';

describe('BDSP static encounter metadata', () => {
  it('keeps the complete source category list and labels', () => {
    expect(CATEGORY_OPTIONS.map(option => option.label)).toEqual([
      '御三家',
      '全部',
      '赠送',
      '化石',
      '定点',
      '游走',
      '传说',
      '玫瑰公园（纯净空间）',
      '玫瑰公园（奇异空间）',
      '幻兽',
    ]);
  });

  it('returns the seven verified fossil targets', () => {
    expect(getStaticTargets('fossils').map(target => target.species)).toEqual([
      '菊石兽',
      '化石盔',
      '化石翼龙',
      '触手百合',
      '太古羽虫',
      '头盖龙',
      '盾甲龙',
    ]);
  });

  it('contains every verified BDSP template row when no version is selected', () => {
    expect(getStaticTargets('all')).toHaveLength(47);
  });

  it('applies the source version restrictions', () => {
    expect(getStaticTargets('legends', 'BD').map(target => target.species)).toContain('帝牙卢卡');
    expect(getStaticTargets('legends', 'BD').map(target => target.species)).not.toContain('帕路奇亚');
    expect(getStaticTargets('legends', 'SP').map(target => target.species)).toContain('帕路奇亚');
    expect(getStaticTargets('legends', 'SP').map(target => target.species)).not.toContain('帝牙卢卡');
  });

  it('uses the exact nature order used by the source project', () => {
    expect(NATURES_ZH).toEqual([
      '勤奋', '怕寂寞', '勇敢', '固执', '顽皮', '大胆', '坦率', '悠闲', '淘气', '乐天',
      '胆小', '急躁', '认真', '爽朗', '天真', '内敛', '慢吞吞', '冷静', '害羞', '马虎',
      '温和', '温顺', '自大', '慎重', '浮躁',
    ]);
  });
});
