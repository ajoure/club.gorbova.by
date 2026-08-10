import { describe, expect, it } from 'vitest';
import { buildAccessRankMap, resolveAccessRank, selectHighestRankedTariff } from './accessTierRank';

describe('access tier rank', () => {
  it('uses configured access_rank before ordering fields', () => {
    expect(resolveAccessRank({ id: 'a', meta: { access_rank: 30 }, sort_order: 1, display_order: 2 })).toBe(30);
  });

  it('falls back to sort_order and never to a tariff name', () => {
    const map = buildAccessRankMap([
      { id: 'paid', meta: {}, sort_order: 0, display_order: 99 },
      { id: 'bonus', meta: {}, sort_order: 2, display_order: 0 },
    ]);
    expect(map).toEqual({ paid: 0, bonus: 2 });
  });

  it('selects the highest active tier independently from duration', () => {
    const paid = { id: 'long-paid', tariff_id: 'paid', expiresAt: '2027-01-01' };
    const bonus = { id: 'short-bonus', tariff_id: 'bonus', expiresAt: '2026-09-09' };
    expect(selectHighestRankedTariff([paid, bonus], ['paid', 'bonus'], { paid: 10, bonus: 30 })).toBe(bonus);
  });

  it('falls back to paid tier when the bonus is no longer active', () => {
    const paid = { id: 'paid', tariff_id: 'paid' };
    const bonus = { id: 'bonus', tariff_id: 'bonus' };
    expect(selectHighestRankedTariff([paid, bonus], ['paid'], { paid: 10, bonus: 30 })).toBe(paid);
  });
});
