import { describe, expect, it } from 'vitest';
import { buildGrantAccessBody, confirmedGrantIds, localDateTimeValue, parseLocalDateTime, verifyGrantAccessReadback } from './grantAccessForm';

const end = new Date('2026-09-30T03:01:53.529Z');
const body = { orderId: 'order', start: new Date('2026-08-31T03:01:53.529Z'), days: 30,
  extendFromCurrent: false, grantTelegram: true, grantGetcourse: false };
const sub = { id: 'sub', user_id: 'user', product_id: 'product', tariff_id: 'tariff', order_id: 'parent',
  meta: { extended_by_orders: ['order'] }, status: 'active', access_end_at: end.toISOString() };
const ent = { id: 'ent', user_id: 'user', product_id: 'product', order_id: 'order', status: 'active', expires_at: end.toISOString() };
const proof = { orderId: 'order', userId: 'user', productId: 'product', tariffId: 'tariff',
  subscription: sub, entitlement: ent, minimumEnd: end, expectedExistingSubscriptionId: 'sub' };

describe('grant form exact request and proof', () => {
  it('round-trips local datetime including seconds and milliseconds', () => {
    expect(parseLocalDateTime(localDateTimeValue(end))?.toISOString()).toBe(end.toISOString());
    expect(parseLocalDateTime('2026-09-30T12:34')?.getSeconds()).toBe(0);
    expect(parseLocalDateTime('2026-09-30T12:34:53.52')?.getMilliseconds()).toBe(520);
  });
  it.each(['', 'invalid', '2026-02-30T12:00', '2026-09-31T12:00', '2026-09-30T25:00', '2026-09-30T03:01Z'])
    ('rejects invalid local datetime %s', value => expect(parseLocalDateTime(value)).toBeNull());
  it('omits days and manual override, keeps the same order and forces extension', () => {
    const result = buildGrantAccessBody({ ...body, exactEnd: end, expectedExistingSubscriptionId: 'sub' });
    expect(result).toMatchObject({ orderId: 'order', customAccessEndAt: end.toISOString(), expectedExistingSubscriptionId: 'sub', extendFromCurrent: true });
    expect(result).not.toHaveProperty('customAccessDays');
    expect(result).not.toHaveProperty('adminManualAccessEdit');
    expect(result).not.toHaveProperty('manualSubscriptionId');
    expect(result.grantGetcourse).toBe(false);
  });
  it('preserves the legacy day request and requires an existing exact target', () => {
    expect(buildGrantAccessBody(body)).toMatchObject({ customAccessDays: 30, extendFromCurrent: false });
    expect(buildGrantAccessBody(body)).not.toHaveProperty('expectedExistingSubscriptionId');
    expect(() => buildGrantAccessBody({ ...body, exactEnd: end })).toThrow('Не подтверждена');
  });
  it.each([null, {}, { success: false }, { success: true, skipped: true }, { success: true, manual_review: true },
    { success: true, manualReview: true }, { success: true, error: 'failure' }, { success: true }])
    ('never treats an unconfirmed or skipped response as success: %j', value => expect(() => confirmedGrantIds(value)).toThrow());
  it('supports normal and idempotent response ID shapes', () => {
    expect(confirmedGrantIds({ success: true, results: { subscription: { id: 'sub' }, entitlement: { id: 'ent' } } }))
      .toMatchObject({ subscriptionId: 'sub', entitlementId: 'ent' });
    expect(confirmedGrantIds({ success: true, already_fulfilled: true, subscription_id: 'sub', entitlement_id: 'ent' }))
      .toMatchObject({ subscriptionId: 'sub', entitlementId: 'ent' });
  });
  it('reads the full period on the same subscription without requiring a new order', () => {
    expect(verifyGrantAccessReadback(proof).toISOString()).toBe(end.toISOString());
  });
  it.each(['user_id', 'product_id', 'tariff_id', 'status', 'id', 'meta'])('rejects wrong subscription %s', key => {
    expect(() => verifyGrantAccessReadback({ ...proof, subscription: { ...sub, [key]: 'wrong' } })).toThrow();
  });
  it.each(['user_id', 'product_id', 'status', 'order_id'])('rejects wrong entitlement %s', key => {
    expect(() => verifyGrantAccessReadback({ ...proof, entitlement: { ...ent, [key]: 'wrong' } })).toThrow();
  });
  it.each(['subscription', 'entitlement'])('rejects a %s even one millisecond short', target => {
    const short = new Date(end.getTime() - 1).toISOString();
    expect(() => verifyGrantAccessReadback({ ...proof,
      ...(target === 'subscription' ? { subscription: { ...sub, access_end_at: short } } : { entitlement: { ...ent, expires_at: short } }),
    })).toThrow();
  });
});
