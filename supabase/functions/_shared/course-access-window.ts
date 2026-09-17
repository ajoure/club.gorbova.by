import { APP_TZ, dayWindowUtc } from './timezone.ts';

function parseCourseDate(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('invalid_course_access_date');
  }
  const date = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('invalid_course_access_date');
  }
  return date;
}

function endOfMinskCourseDay(date: Date): Date {
  const { end } = dayWindowUtc(APP_TZ, date.toISOString().slice(0, 10));
  // Keep the course day inclusive. This matches the normalizer used for the
  // existing versioned-course policy and avoids cutting a day at 00:00.
  return new Date(Date.parse(end) - 1000);
}

/** Only versioned tariffs opt in. Old purchases retain their existing clock. */
export function courseAccessEnd(meta: unknown): Date | null {
  if (!meta || typeof meta !== 'object') return null;
  const policy = (meta as Record<string, unknown>).course_access;
  if (policy == null) return null;
  if (typeof policy !== 'object') throw new Error('invalid_course_access_policy');
  const p = policy as Record<string, unknown>;

  if (p.kind === 'course_end_calendar_months') {
    if (p.timezone !== APP_TZ || !Number.isInteger(p.months) || Number(p.months) < 0 || Number(p.months) > 120) {
      throw new Error('invalid_course_access_policy');
    }
    const source = parseCourseDate(p.end_date);
    const targetMonth = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + Number(p.months), 1));
    const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
    targetMonth.setUTCDate(Math.min(source.getUTCDate(), lastDay));
    return endOfMinskCourseDay(targetMonth);
  }

  if (p.kind === 'course_start_duration_days') {
    if (p.timezone !== APP_TZ || !Number.isInteger(p.days) || Number(p.days) < 1 || Number(p.days) > 3660) {
      throw new Error('invalid_course_access_policy');
    }
    const start = parseCourseDate(p.start_date);
    // The start day is day 1: 23 October + 180 calendar days means inclusive
    // access through 20 April, rather than through midnight on 21 April.
    const lastAccessDay = new Date(Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate() + Number(p.days) - 1,
      12,
    ));
    return endOfMinskCourseDay(lastAccessDay);
  }

  throw new Error('invalid_course_access_policy');
}
