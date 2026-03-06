/**
 * Shared system token resolver for edge functions.
 * Resolves date/time tokens like {{today}}, {{tomorrow}}, etc.
 * Timezone: imported from _shared/timezone.ts (APP_TZ = Europe/Minsk).
 * DST-safe: uses Intl.DateTimeFormat.formatToParts for calendar arithmetic.
 */
import { APP_TZ, todayDateKey, addDaysToDateKey } from './timezone.ts';

/** Russian month names (nominative, lowercase) */
const RU_MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

/** Russian weekday names (lowercase) */
const RU_WEEKDAYS = [
  'воскресенье', 'понедельник', 'вторник', 'среда',
  'четверг', 'пятница', 'суббота',
];

/**
 * Format a dateKey (YYYY-MM-DD) as dd.MM.yyyy
 */
function dateKeyToDot(dateKey: string): string {
  const [y, m, d] = dateKey.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * Get time string HH:mm in APP_TZ for a given Date.
 */
function timeInTz(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find(p => p.type === type)?.value || '00';
  return `${get('hour')}:${get('minute')}`;
}

/**
 * Get weekday index (0=Sun..6=Sat) for a dateKey in APP_TZ.
 */
function weekdayOfDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  // Date.UTC gives correct day-of-week for calendar dates
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Resolve system date/time tokens in a template string.
 * Pass a single `now` per broadcast run so all recipients get the same dates.
 * 
 * Supported tokens:
 *   {{today}}      → dd.MM.yyyy
 *   {{tomorrow}}   → dd.MM.yyyy (calendar +1 day, DST-safe)
 *   {{yesterday}}  → dd.MM.yyyy (calendar -1 day, DST-safe)
 *   {{now}}        → dd.MM.yyyy HH:mm
 *   {{month_name}} → русский месяц (январь..декабрь)
 *   {{month}}      → 01-12
 *   {{year}}       → yyyy
 *   {{day}}        → 01-31
 *   {{weekday}}    → русский день недели (понедельник..воскресенье)
 */
export function resolveSystemTokens(text: string, now: Date): string {
  if (!text.includes('{{')) return text;

  const tz = APP_TZ;
  const todayKey = todayDateKey(tz);              // YYYY-MM-DD
  const tomorrowKey = addDaysToDateKey(todayKey, 1);
  const yesterdayKey = addDaysToDateKey(todayKey, -1);

  const [yyyy, mm, dd] = todayKey.split('-');
  const monthIdx = parseInt(mm, 10) - 1;          // 0-based

  return text
    .replace(/\{\{today\}\}/g, dateKeyToDot(todayKey))
    .replace(/\{\{tomorrow\}\}/g, dateKeyToDot(tomorrowKey))
    .replace(/\{\{yesterday\}\}/g, dateKeyToDot(yesterdayKey))
    .replace(/\{\{now\}\}/g, `${dateKeyToDot(todayKey)} ${timeInTz(now, tz)}`)
    .replace(/\{\{month_name\}\}/g, RU_MONTHS[monthIdx] || '')
    .replace(/\{\{month\}\}/g, mm)
    .replace(/\{\{year\}\}/g, yyyy)
    .replace(/\{\{day\}\}/g, dd)
    .replace(/\{\{weekday\}\}/g, RU_WEEKDAYS[weekdayOfDateKey(todayKey)] || '');
}

/** Known system token keys (for audit logging) */
export const SYSTEM_TOKEN_KEYS = [
  'today', 'tomorrow', 'yesterday', 'now',
  'month_name', 'month', 'year', 'day', 'weekday',
] as const;

/** Known contact token keys (for audit logging) */
export const CONTACT_TOKEN_KEYS = [
  'full_name', 'first_name', 'last_name', 'name',
  'email', 'phone', 'telegram_username',
] as const;

/**
 * Extract used token keys from a template string for audit logging.
 * Returns { contact: [...], system: [...] }
 */
export function extractUsedTokens(text: string): { contact: string[]; system: string[] } {
  const allMatches = text.match(/\{\{(\w+)\}\}/g) || [];
  const raw = allMatches.map(m => m.replace(/\{\{|\}\}/g, ''));
  const unique = [...new Set(raw)];

  const systemSet = new Set<string>(SYSTEM_TOKEN_KEYS as unknown as string[]);
  const contactSet = new Set<string>(CONTACT_TOKEN_KEYS as unknown as string[]);

  return {
    contact: unique.filter(k => contactSet.has(k)),
    system: unique.filter(k => systemSet.has(k)),
  };
}
