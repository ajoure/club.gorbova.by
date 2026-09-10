import { APP_TZ, dayWindowUtc } from './timezone.ts';

/** Only versioned tariffs opt in. Old purchases retain their existing clock. */
export function courseAccessEnd(meta: unknown): Date | null {
  if (!meta || typeof meta !== 'object') return null;
  const policy = (meta as Record<string, unknown>).course_access;
  if (policy == null) return null;
  if (typeof policy !== 'object') throw new Error('invalid_course_access_policy');
  const p = policy as Record<string, unknown>;
  if (p.kind !== 'course_end_calendar_months' || p.timezone !== APP_TZ ||
      typeof p.end_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.end_date) ||
      !Number.isInteger(p.months) || Number(p.months) < 0 || Number(p.months) > 120) {
    throw new Error('invalid_course_access_policy');
  }
  const source = new Date(`${p.end_date}T12:00:00.000Z`);
  if (!Number.isFinite(source.getTime()) || source.toISOString().slice(0, 10) !== p.end_date) {
    throw new Error('invalid_course_access_date');
  }
  const targetMonth = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + Number(p.months), 1));
  const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  targetMonth.setUTCDate(Math.min(source.getUTCDate(), lastDay));
  const { end } = dayWindowUtc(APP_TZ, targetMonth.toISOString().slice(0, 10));
  // Same inclusive end-of-day precision as the canonical access normalizer.
  return new Date(Date.parse(end) - 1000);
}
