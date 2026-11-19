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

  if (p.kind === 'fixed_exclusive_end') {
    if (p.timezone !== APP_TZ || typeof p.end_exclusive !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(p.end_exclusive)) {
      throw new Error('invalid_course_access_policy');
    }
    const end = new Date(p.end_exclusive);
    if (!Number.isFinite(end.getTime()) || end.toISOString().replace('.000Z', 'Z') !== p.end_exclusive.replace('.000Z', 'Z')) {
      throw new Error('invalid_course_access_policy');
    }
    // Already exclusive: never subtract a second or add an installment interval.
    return end;
  }

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


/** Freeze only the new opt-in clock; existing course policies retain legacy resolution. */
export function courseAccessSnapshot(meta: unknown): Record<string, unknown> {
  const policy = meta && typeof meta === 'object' ? (meta as Record<string, unknown>).course_access : null;
  if (!policy || typeof policy !== 'object' || (policy as Record<string, unknown>).kind !== 'fixed_exclusive_end') return {};
  const end = courseAccessEnd(meta)!;
  return { course_access: { kind: 'fixed_exclusive_end', timezone: APP_TZ, end_exclusive: end.toISOString() } };
}

/** An immutable fixed-end purchase promise takes precedence over a later tariff edit.
 * A malformed frozen clock must fail, never silently fall back to a rolling window. */
export function courseAccessEndForPurchase(tariffMeta: unknown, purchaseSnapshot: unknown): Date | null {
  if (purchaseSnapshot && typeof purchaseSnapshot === 'object') {
    const snapshot = purchaseSnapshot as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(snapshot, 'course_access')) {
      const end = courseAccessEnd(snapshot);
      if (!end || !snapshot.course_access || typeof snapshot.course_access !== 'object'
        || (snapshot.course_access as Record<string, unknown>).kind !== 'fixed_exclusive_end') {
        throw new Error('invalid_purchase_course_access_policy');
      }
      if (snapshot.planned_access_end_at != null
        && (typeof snapshot.planned_access_end_at !== 'string' || Date.parse(snapshot.planned_access_end_at) !== end.getTime())) {
        throw new Error('purchase_course_access_end_mismatch');
      }
      return end;
    }
  }
  return courseAccessEnd(tariffMeta);
}


export function hasFixedExclusiveCourseEnd(tariffMeta: unknown, purchaseSnapshot: unknown): boolean {
  const snapshot = purchaseSnapshot && typeof purchaseSnapshot === 'object' ? purchaseSnapshot as Record<string, unknown> : null;
  const source = snapshot && Object.prototype.hasOwnProperty.call(snapshot, 'course_access')
    ? snapshot : tariffMeta && typeof tariffMeta === 'object' ? tariffMeta as Record<string, unknown> : null;
  return !!source?.course_access && typeof source.course_access === 'object'
    && (source.course_access as Record<string, unknown>).kind === 'fixed_exclusive_end';
}
