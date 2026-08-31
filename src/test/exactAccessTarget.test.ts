import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseExactAccessTarget, exactAccessTargetError, exactAccessOrderAllowed } from '../../supabase/functions/grant-access-for-order/exact_access_target';
import { accessDateReachesWindow } from '../../supabase/functions/grant-access-for-order/payment_window';

const id = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-08-31T10:00:00Z');
const end = '2026-09-30T03:01:53.529Z';
const request = { expectedExistingSubscriptionId: id, customAccessEndAt: end, extendFromCurrent: true };
const sub = { id, status: 'active', access_end_at: '2026-08-31T03:01:53.529Z' };

describe('exact existing paid access target', () => {
  it('requires a paid subscription-based order for this repair mode', () => {
    expect(exactAccessOrderAllowed('paid', null)).toBe(true);
    expect(exactAccessOrderAllowed('partial', null)).toBe(false);
    expect(exactAccessOrderAllowed('pending', null)).toBe(false);
    expect(exactAccessOrderAllowed('paid', 'order_based_only')).toBe(false);
  });
  it('leaves legacy callers unchanged', () => {
    expect(parseExactAccessTarget({}, now)).toBeNull();
    expect(exactAccessTargetError(null, null)).toBeNull();
  });
  it.each([
    { expectedExistingSubscriptionId: 'invalid' }, { customAccessEndAt: 'invalid' },
    { customAccessEndAt: '2026-09-30T03:01' }, { customAccessEndAt: now.toISOString() },
    { customAccessEndAt: '2026-08-01T00:00:00Z' }, { extendFromCurrent: false },
  ])('rejects malformed or unsafe exact requests: %j', change => {
    expect(() => parseExactAccessTarget({ ...request, ...change }, now)).toThrow('exact_access_invalid_request');
  });
  it('preserves millisecond precision and allows only the expected chain', () => {
    const target = parseExactAccessTarget(request, now)!;
    expect(target.end.toISOString()).toBe(end);
    expect(exactAccessTargetError(target, sub)).toBeNull();
    expect(exactAccessTargetError(target, { ...sub, status: 'expired' })).toBeNull();
    expect(exactAccessTargetError(target, null)).toBe('exact_access_existing_subscription_changed');
    expect(exactAccessTargetError(target, { ...sub, id: 'other' })).toBe('exact_access_existing_subscription_changed');
  });
  it.each(['canceled', 'superseded', 'expired_reentry'])('blocks terminal %s', status => {
    expect(exactAccessTargetError(parseExactAccessTarget(request, now), { ...sub, status }))
      .toBe('exact_access_existing_subscription_changed');
  });
  it('blocks invalid previous dates and any shortening, including one millisecond', () => {
    const target = parseExactAccessTarget(request, now)!;
    expect(exactAccessTargetError(target, { ...sub, access_end_at: null })).toBe('exact_access_existing_window_invalid');
    expect(exactAccessTargetError(target, { ...sub, access_end_at: new Date(target.end.getTime() + 1).toISOString() }))
      .toBe('exact_access_cannot_shorten');
    expect(exactAccessTargetError(target, { ...sub, access_end_at: end })).toBeNull();
  });
  it('blocks a same-ID subscription moved to another product or tariff since preview', () => {
    const target = parseExactAccessTarget(request, now)!;
    const scope = { productId: 'product', tariffId: 'tariff' };
    const same = { ...sub, product_id: 'product', tariff_id: 'tariff' };
    expect(exactAccessTargetError(target, same, scope)).toBeNull();
    expect(exactAccessTargetError(target, { ...same, product_id: 'other' }, scope)).toBe('exact_access_existing_subscription_changed');
    expect(exactAccessTargetError(target, { ...same, tariff_id: 'other' }, scope)).toBe('exact_access_existing_subscription_changed');
  });
  it.each([1, 30 * 60 * 1000])('explicit end has no legacy tolerance (%i ms short)', short => {
    const target = new Date(end);
    const previous = new Date(target.getTime() - short).toISOString();
    expect(accessDateReachesWindow(previous, target)).toBe(true);
    expect(accessDateReachesWindow(previous, target, true)).toBe(false);
    expect(accessDateReachesWindow(end, target, true)).toBe(true);
  });
  it('gates both fulfilment branches before grants and preserves billing configuration', () => {
    const source = readFileSync('supabase/functions/grant-access-for-order/index.ts', 'utf8');
    const replay = source.slice(source.indexOf('} else if (entitlementMatchesProduct &&'), source.indexOf('// Log if entitlement exists'));
    expect(replay.indexOf('exactTargetConflict(resolvedSubscription)')).toBeLessThan(replay.indexOf('syncSecondaryProductAccessForUser('));
    expect(source.indexOf('exactTargetConflict(existingProductSub)')).toBeLessThan(source.indexOf('// 1. Upsert entitlement'));
    expect(source.indexOf('exactTargetConflict(activeSub)')).toBeLessThan(source.indexOf('// ── TARIFF + bePaid SBS MATCH GUARD'));
    expect(source).toContain('if (!exactAccessTarget && !fullExistingSub?.payment_method_id && hasPaymentMethod)');
    expect(source).toContain('if (!exactAccessTarget && !extendRecurringSnapshot)');
    expect(source).toContain("...(exactAccessTarget ? { last_extension_mode: 'exact_existing' } : {");
    expect(source.indexOf('enforceBranchPolicy(branch, caller)')).toBeLessThan(source.indexOf('parseExactAccessTarget({'));
    expect(source.indexOf('if (exactAccessTarget && isNoCardTrial)')).toBeLessThan(source.indexOf('// ── IDEMPOTENCY HARD GUARD'));
    expect(source.indexOf('enforceBranchPolicy(branch, caller)')).toBeLessThan(source.indexOf("if (req.method === 'GET')"));
    expect(source.indexOf("if (req.method === 'GET')")).toBeLessThan(source.indexOf('// Load order with product/tariff info'));
  });
});
