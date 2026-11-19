import { describe, expect, it } from 'vitest';
import { courseAccessEnd, courseAccessSnapshot, courseAccessEndForPurchase, hasFixedExclusiveCourseEnd } from '../../supabase/functions/_shared/course-access-window';
import { buildPurchaseSnapshot } from '../../supabase/functions/_shared/build-purchase-snapshot';
import { resolveStaleAccessPolicy } from '../../supabase/functions/grant-access-for-order/stale_access_policy';
import { ZG27_ACCESS_END_EXCLUSIVE } from '../../supabase/functions/_shared/zg27-policy';
const fixed = { course_access: { kind: 'fixed_exclusive_end', timezone: 'Europe/Minsk', end_exclusive: ZG27_ACCESS_END_EXCLUSIVE } };

describe('fixed exclusive course promise', () => {
  it('includes the last April Minsk day and expires at exact midnight without a -1s conversion', () => {
    const end = courseAccessEnd(fixed)!;
    expect(end.toISOString()).toBe('2027-04-30T21:00:00.000Z');
    expect(new Date('2027-04-30T20:59:59.999Z').getTime()).toBeLessThan(end.getTime());
    for (const at of ['2027-04-30T21:00:00.000Z', '2027-05-01T00:00:00.000Z']) {
      const result = resolveStaleAccessPolicy({ canonicalAccessEndAt: end, now: new Date(at), shouldAutoRenew: false, fixedCourseWindow: true, exclusiveEnd: true });
      expect(result.status).toBe('expired'); expect(result.accessEndAt).toEqual(end); expect(result.placeholderApplied).toBe(false);
    }
  });
  it('freezes the promise at creation and resolves it despite a later live tariff change', () => {
    const snapshot = buildPurchaseSnapshot({ planned_access_end_at: ZG27_ACCESS_END_EXCLUSIVE, extra: courseAccessSnapshot(fixed) });
    const changed = { course_access: { ...fixed.course_access, end_exclusive: '2028-01-01T00:00:00Z' } };
    expect(courseAccessEndForPurchase(changed, snapshot)?.toISOString()).toBe(ZG27_ACCESS_END_EXCLUSIVE);
    expect(courseAccessEndForPurchase(null, snapshot)?.toISOString()).toBe(ZG27_ACCESS_END_EXCLUSIVE);
  });
  it.each(['2027-02-30T21:00:00Z', 'invalid', '2027-04-30', '2027-04-30T21:00:00'])('rejects malformed fixed end %s', end_exclusive => {
    expect(() => courseAccessEnd({ course_access: { ...fixed.course_access, end_exclusive } })).toThrow();
  });
  it('rejects wrong timezone, malformed snapshot and planned-end mismatch rather than rolling fallback', () => {
    expect(() => courseAccessEnd({ course_access: { ...fixed.course_access, timezone: 'UTC' } })).toThrow();
    expect(() => courseAccessEndForPurchase({}, { course_access: null })).toThrow();
    expect(() => courseAccessEndForPurchase({}, { ...fixed, planned_access_end_at: '2027-05-02T00:00:00Z' })).toThrow();
  });
  it('detects snapshot clock precedence and leaves old equality semantics intact', () => {
    expect(hasFixedExclusiveCourseEnd({}, courseAccessSnapshot(fixed))).toBe(true);
    expect(hasFixedExclusiveCourseEnd(fixed, {})).toBe(true);
    expect(hasFixedExclusiveCourseEnd({}, {})).toBe(false);
    const end = new Date(ZG27_ACCESS_END_EXCLUSIVE);
    expect(resolveStaleAccessPolicy({ canonicalAccessEndAt: end, now: end, shouldAutoRenew: false, fixedCourseWindow: true }).status).toBe('active');
  });
  it('does not change legacy purchases or freeze an unrelated old course clock', () => {
    expect(courseAccessSnapshot({ access_days: 60 })).toEqual({});
    expect(courseAccessEndForPurchase({ access_days: 60 }, { access_days: 60 })).toBeNull();
    const old = { course_access: { kind: 'course_start_duration_days', timezone: 'Europe/Minsk', start_date: '2026-10-23', days: 180 } };
    expect(courseAccessSnapshot(old)).toEqual({});
    expect(courseAccessEndForPurchase(old, {})?.toISOString()).toBe('2027-04-20T20:59:59.000Z');
  });
});
