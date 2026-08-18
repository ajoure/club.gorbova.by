/**
 * Client-side system token resolver for UI previews.
 * Mirrors the backend resolveSystemTokens() logic.
 * Timezone: Europe/Minsk (APP_TZ), same as backend.
 */

const APP_TZ = 'Europe/Minsk';

const RU_MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

const RU_WEEKDAYS = [
  'воскресенье', 'понедельник', 'вторник', 'среда',
  'четверг', 'пятница', 'суббота',
];

function getTodayParts(now: Date): { yyyy: string; mm: string; dd: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  return { yyyy: get('year'), mm: get('month'), dd: get('day') };
}

function dateKeyToDot(dateKey: string): string {
  const [y, m, d] = dateKey.split('-');
  return `${d}.${m}.${y}`;
}

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function timeInTz(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (t: string) => parts.find(p => p.type === t)?.value || '00';
  return `${get('hour')}:${get('minute')}`;
}

/**
 * Resolve system date/time tokens for UI preview.
 * Same tokens as backend: today, tomorrow, yesterday, now, month_name, month, year, day, weekday.
 */
export function resolveSystemTokens(text: string, now: Date = new Date()): string {
  if (!text.includes('{{')) return text;

  const { yyyy, mm, dd } = getTodayParts(now);
  const todayKey = `${yyyy}-${mm}-${dd}`;
  const tomorrowKey = addDays(todayKey, 1);
  const yesterdayKey = addDays(todayKey, -1);

  const monthIdx = parseInt(mm, 10) - 1;
  const weekdayIdx = new Date(Date.UTC(parseInt(yyyy), monthIdx, parseInt(dd))).getUTCDay();
  const RU_MONTHS_GEN = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  const todayDot = dateKeyToDot(todayKey);
  const tomorrowDot = dateKeyToDot(tomorrowKey);
  const yesterdayDot = dateKeyToDot(yesterdayKey);
  const nowValue = `${todayDot} ${timeInTz(now)}`;
  const monthName = RU_MONTHS[monthIdx] || '';
  const weekdayName = RU_WEEKDAYS[weekdayIdx] || '';
  const todayLong = `${dd} ${RU_MONTHS_GEN[monthIdx] || ''} ${yyyy} г.`;
  const todayRu = `${dd} ${RU_MONTHS_GEN[monthIdx] || ''} ${yyyy} года`;

  return text
    .replace(/\{\{today\}\}/g, todayDot)
    .replace(/\{\{tomorrow\}\}/g, tomorrowDot)
    .replace(/\{\{yesterday\}\}/g, yesterdayDot)
    .replace(/\{\{now\}\}/g, nowValue)
    .replace(/\{\{month_name\}\}/g, monthName)
    .replace(/\{\{month\}\}/g, mm)
    .replace(/\{\{year\}\}/g, yyyy)
    .replace(/\{\{day\}\}/g, dd)
    .replace(/\{\{weekday\}\}/g, weekdayName)
    .replace(/\{\{system\.today\}\}/g, todayDot)
    .replace(/\{\{system\.tomorrow\}\}/g, tomorrowDot)
    .replace(/\{\{system\.yesterday\}\}/g, yesterdayDot)
    .replace(/\{\{system\.now\}\}/g, nowValue)
    .replace(/\{\{system\.month_name\}\}/g, monthName)
    .replace(/\{\{system\.month\}\}/g, mm)
    .replace(/\{\{system\.year\}\}/g, yyyy)
    .replace(/\{\{system\.day\}\}/g, dd)
    .replace(/\{\{system\.weekday\}\}/g, weekdayName)
    .replace(/\{\{system\.today_long\}\}/g, todayLong)
    .replace(/\{\{system\.today_ru\}\}/g, todayRu);
}
