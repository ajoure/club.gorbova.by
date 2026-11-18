import { describe, expect, it } from 'vitest';
import { checkZg27NewSale, classifyZg27Participation, zg27InstallmentAmounts, ZG27_ACCESS_END_EXCLUSIVE, ZG27_PRODUCT_ID, ZG27_TIERS } from '../../supabase/functions/_shared/zg27-policy';

function request() {
  return { productId: ZG27_PRODUCT_ID, tariffId: ZG27_TIERS.repeat.tariffId, offerProductId: ZG27_PRODUCT_ID,
    offerTariffId: ZG27_TIERS.repeat.tariffId, offerActive: true, offerAmount: 890, installmentCount: 3,
    currency: 'BYN', category: 'repeat' as const, now: new Date('2026-11-18T12:00:00Z') };
}

describe('approved ZG27 commercial boundary', () => {
  it.each([
    ['absent', 'confirmed', 'not_eligible'], ['confirmed', 'absent', 'first'], ['confirmed', 'confirmed', 'repeat'],
    ['unknown', 'confirmed', 'unavailable'], ['confirmed', 'unknown', 'unavailable'],
  ] as const)('CB=%s oldZG=%s -> %s', (cb, previousZg, category) => {
    expect(classifyZg27Participation({ authenticated: true, cb, previousZg })).toBe(category);
  });
  it('does not authorize an anonymous holder of a forwarded link', () => {
    expect(classifyZg27Participation({ authenticated: false, cb: 'confirmed', previousZg: 'confirmed' })).toBe('login_required');
    expect(checkZg27NewSale({ ...request(), category: 'login_required' })).toMatchObject({ allowed: false });
  });
  it.each([
    ['first', 1, [1290]], ['first', 2, [645, 645]], ['first', 3, [430, 430, 430]],
    ['repeat', 1, [890]], ['repeat', 2, [445, 445]], ['repeat', 3, [296.67, 296.67, 296.66]],
  ] as const)('preserves approved total for %s / %s', (tier, n, expected) => {
    const amounts = zg27InstallmentAmounts(tier, n);
    expect(amounts).toEqual([...expected]);
    expect(amounts.reduce((sum, amount) => sum + Math.round(amount * 100), 0)).toBe(ZG27_TIERS[tier].totalMinor);
  });
  it('rejects a first participant using the repeat tariff', () => {
    expect(checkZg27NewSale({ ...request(), category: 'first' })).toMatchObject({ allowed: false, reason: 'zg27_wrong_participation', page: 'zg27pervoe' });
  });
  it('does not silently charge a repeat participant the first price', () => {
    expect(checkZg27NewSale({ ...request(), tariffId: ZG27_TIERS.first.tariffId, offerTariffId: ZG27_TIERS.first.tariffId, offerAmount: 1290 })).toMatchObject({ allowed: false, page: 'zg27povtor' });
  });
  it.each([{ offerAmount: 900 }, { offerAmount: Number.NaN }, { currency: 'RUB' }, { installmentCount: 0 },
    { installmentCount: 4 }, { installmentCount: 2.5 }, { offerTariffId: null }, { offerActive: false },
    { productId: 'other' }, { offerProductId: 'other' }, { category: 'unavailable' as const }])('fails closed for invalid quote %j', (patch) => {
    expect(checkZg27NewSale({ ...request(), ...patch })).toMatchObject({ applicable: true, allowed: false });
  });
  it('keeps existing unrelated products outside this additional gate', () => {
    expect(checkZg27NewSale({ ...request(), productId: 'old-product', offerProductId: 'old-product', tariffId: 'old-tariff', offerTariffId: 'old-tariff' })).toEqual({ applicable: false });
  });
  it('rejects product substitution even if both product IDs are forged', () => {
    expect(checkZg27NewSale({ ...request(), productId: 'other', offerProductId: 'other' })).toMatchObject({ applicable: true, allowed: false });
  });
  it('ends on the exact Minsk midnight boundary, not 60 days from purchase', () => {
    const end = Date.parse(ZG27_ACCESS_END_EXCLUSIVE);
    expect(checkZg27NewSale({ ...request(), now: new Date(end - 1) })).toMatchObject({ allowed: true, accessEndExclusive: ZG27_ACCESS_END_EXCLUSIVE });
    expect(checkZg27NewSale({ ...request(), now: new Date(end) })).toMatchObject({ allowed: false, reason: 'zg27_sale_closed' });
    expect(checkZg27NewSale({ ...request(), now: new Date('invalid') })).toMatchObject({ allowed: false });
  });
});
