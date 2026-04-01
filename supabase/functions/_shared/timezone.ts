/**
 * F10 — Shared timezone helper for consistent day-window calculations.
 * All business-logic "today/tomorrow/N days" must use APP_TZ, not UTC or server-local time.
 */

/** Single source of truth for business-logic timezone */
export const APP_TZ = 'Europe/Minsk';

/** Current UTC time as ISO string */
export function nowUtcIso(): string {
  return new Date().toISOString();
}

/**
 * Convert a UTC ISO timestamp to a date key (YYYY-MM-DD) in the given timezone.
 * Uses Intl.DateTimeFormat for correct DST handling.
 */
export function toTzDateKey(utcIso: string, tz: string = APP_TZ): string {
  const d = new Date(utcIso);
  // Intl gives us the date parts in the target timezone
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA locale formats as YYYY-MM-DD
  return fmt.format(d);
}

/**
 * Get today's date key in the given timezone.
 */
export function todayDateKey(tz: string = APP_TZ): string {
  return toTzDateKey(new Date().toISOString(), tz);
}

/**
 * Add N days to a dateKey string (YYYY-MM-DD) and return new dateKey.
 */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Calculate the UTC start and end of a calendar day in the given timezone.
 * 
 * Example for Europe/Minsk (UTC+3), dateKey='2026-02-27':
 *   start = 2026-02-26T21:00:00.000Z  (00:00 Minsk on Feb 27)
 *   end   = 2026-02-27T21:00:00.000Z  (00:00 Minsk on Feb 28, exclusive)
 *
 * This correctly handles DST transitions.
 */
export function dayWindowUtc(tz: string, dateKey: string): { start: string; end: string } {
  // Parse the dateKey
  const [year, month, day] = dateKey.split('-').map(Number);
  
  // We need to find what UTC time corresponds to 00:00 on dateKey in tz.
  // Strategy: start with a rough estimate, then binary-search/adjust.
  // For most cases, the offset is stable within a day.
  
  const startUtc = findUtcForLocalMidnight(tz, year, month, day);
  
  // Next day
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const endUtc = findUtcForLocalMidnight(
    tz, 
    nextDay.getUTCFullYear(), 
    nextDay.getUTCMonth() + 1, 
    nextDay.getUTCDate()
  );
  
  return {
    start: new Date(startUtc).toISOString(),
    end: new Date(endUtc).toISOString(),
  };
}

/**
 * Find the UTC timestamp that corresponds to 00:00:00 on the given date in the given timezone.
 * Uses Intl.DateTimeFormat to determine the actual UTC offset.
 */
function findUtcForLocalMidnight(tz: string, year: number, month: number, day: number): number {
  // Initial guess: assume UTC+3 (Minsk standard)
  // We'll refine by checking what the actual local date is at that UTC time
  let guessUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  
  // Get the offset at our guess point
  const offsetMs = getUtcOffsetMs(tz, guessUtcMs);
  
  // Midnight local = midnight_date_utc - offset
  // If tz is UTC+3, then 00:00 local = 21:00 UTC previous day
  // offset = +3h = +10800000ms
  // utc_midnight_local = Date.UTC(year, month-1, day) - offset
  const candidateUtcMs = guessUtcMs - offsetMs;
  
  // Verify: the local date at candidateUtcMs should be our target date
  const checkDateKey = toTzDateKey(new Date(candidateUtcMs).toISOString(), tz);
  const targetDateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  if (checkDateKey === targetDateKey) {
    return candidateUtcMs;
  }
  
  // DST edge case: re-calculate with the offset at the candidate time
  const offsetMs2 = getUtcOffsetMs(tz, candidateUtcMs);
  return guessUtcMs - offsetMs2;
}

/**
 * Get the UTC offset in milliseconds for a timezone at a given UTC timestamp.
 * Positive = east of UTC (e.g., +3h for Minsk = +10800000).
 */
function getUtcOffsetMs(tz: string, utcMs: number): number {
  const d = new Date(utcMs);
  
  // Get parts in target timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(d);
  
  const get = (type: string): number => {
    const part = parts.find(p => p.type === type);
    return part ? parseInt(part.value, 10) : 0;
  };
  
  const localYear = get('year');
  const localMonth = get('month');
  const localDay = get('day');
  let localHour = get('hour');
  // Intl may return 24 for midnight in hour12=false
  if (localHour === 24) localHour = 0;
  const localMinute = get('minute');
  const localSecond = get('second');
  
  // Construct what UTC would be if these local parts were UTC
  const localAsUtcMs = Date.UTC(localYear, localMonth - 1, localDay, localHour, localMinute, localSecond);
  
  // Offset = local - UTC
  return localAsUtcMs - utcMs;
}

/**
 * endOfDayAppTz — returns 23:59:59 in APP_TZ (Europe/Minsk) for a given ISO date.
 * Used for normalizing access_end_at from bePaid truth fields.
 * 
 * PATCH-FOLLOWUP: Replaced endOfDayWarsaw (Europe/Warsaw) with APP_TZ to eliminate
 * up to 2h timezone drift between access normalization and access validation.
 */
export function endOfDayAppTz(isoDate: string): string {
  const dateKey = toTzDateKey(isoDate, APP_TZ);
  const nextDateKey = addDaysToDateKey(dateKey, 1);
  const { start: nextMidnightUtc } = dayWindowUtc(APP_TZ, nextDateKey);
  // 23:59:59 APP_TZ = next midnight UTC - 1 second
  return new Date(new Date(nextMidnightUtc).getTime() - 1000).toISOString();
}

/** @deprecated Use endOfDayAppTz instead. Kept for backward compatibility. */
export const endOfDayWarsaw = endOfDayAppTz;
