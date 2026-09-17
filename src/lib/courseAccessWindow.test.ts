import { resolveStaleAccessPolicy } from '../../supabase/functions/grant-access-for-order/stale_access_policy';
import { describe, expect, it } from 'vitest';
import { courseAccessEnd } from '../../supabase/functions/_shared/course-access-window';

const meta = (end_date: string, months: number) => ({
  course_access: { kind: 'course_end_calendar_months', end_date, months, timezone: 'Europe/Minsk' },
});

const startDurationMeta = (start_date: string, days: number) => ({
  course_access: { kind: 'course_start_duration_days', start_date, days, timezone: 'Europe/Minsk' },
});

describe('versioned course access, calendar months after completion', () => {
  it.each([[6, '2027-06-10'], [9, '2027-09-10'], [12, '2027-12-10']])(
    '%i months retain the entire final Minsk day', (months, day) => {
      expect(courseAccessEnd(meta('2026-12-10', months))?.toISOString()).toBe(`${day}T20:59:59.000Z`);
    },
  );
  it.each([null, {}, { access_window_rule: 'calendar_month' }, { card_config: {} }])(
    'does not change legacy or club tariffs %j', value => expect(courseAccessEnd(value)).toBeNull(),
  );
  it.each([['2028-01-31', 1, '2028-02-29'], ['2027-01-31', 1, '2027-02-28'], ['2026-10-31', 4, '2027-02-28']])(
    'clamps %s plus %i months to the last real day', (date, months, expected) => {
      expect(courseAccessEnd(meta(date, months))?.toISOString()).toBe(`${expected}T20:59:59.000Z`);
    },
  );
  it.each([meta('2026-02-30', 9), meta('2026-12-10', -1), meta('2026-12-10', 1.5),
    { course_access: {} }, { course_access: 'invalid' }])('rejects corrupt policies %j', value => {
    expect(() => courseAccessEnd(value)).toThrow();
  });
});

describe('versioned course access from the training start', () => {
  it.each([[180, '2027-04-20'], [240, '2027-06-19'], [300, '2027-08-18']])(
    '%i days from 23 October retains the whole final Minsk day', (days, day) => {
      expect(courseAccessEnd(startDurationMeta('2026-10-23', days))?.toISOString()).toBe(`${day}T20:59:59.000Z`);
    },
  );

  it.each([
    startDurationMeta('2026-02-30', 180),
    startDurationMeta('2026-10-23', 0),
    startDurationMeta('2026-10-23', 180.5),
    { course_access: { kind: 'course_start_duration_days', start_date: '2026-10-23', days: 180, timezone: 'Europe/Warsaw' } },
  ])('rejects invalid start-duration policy %j', value => {
    expect(() => courseAccessEnd(value)).toThrow();
  });
});

it('never extends an expired course by the live-provider 48-hour placeholder', () => {
  const end = courseAccessEnd(meta('2026-12-10', 9))!;
  const result = resolveStaleAccessPolicy({ canonicalAccessEndAt: end, now: new Date('2027-09-11T00:00:00Z'), shouldAutoRenew: false, fixedCourseWindow: true });
  expect(result.accessEndAt).toEqual(end);
  expect(result.status).toBe('expired');
  expect(result.placeholderApplied).toBe(false);
});
