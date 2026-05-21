// ============================================================================
// ru-date.ts — Russian-locale date formatters in Europe/Minsk timezone.
// Used by standard-fields.ts (FLD system.*) and strict generator.
// ============================================================================

const TZ = 'Europe/Minsk';

const RU_MONTHS_GEN = [
  'января','февраля','марта','апреля','мая','июня',
  'июля','августа','сентября','октября','ноября','декабря',
];

function getParts(d: Date): { day: number; month: number; year: number; hour: number; minute: number } {
  // Use Intl to project into Europe/Minsk.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    day: Number(map.day),
    month: Number(map.month),
    year: Number(map.year),
    hour: Number(map.hour),
    minute: Number(map.minute === '24' ? '00' : map.minute),
  };
}

function asDate(d?: string | Date | null): Date | null {
  if (!d) return null;
  const dt = typeof d === 'string' ? new Date(d) : d;
  return isNaN(dt.getTime()) ? null : dt;
}

/** dd.MM.yyyy — e.g. 20.05.2026 */
export function dotDate(d?: string | Date | null): string {
  const dt = asDate(d);
  if (!dt) return '';
  const p = getParts(dt);
  return `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year}`;
}

/** dd месяц yyyy г. — e.g. 20 мая 2026 г. */
export function ruLongDate(d?: string | Date | null): string {
  const dt = asDate(d);
  if (!dt) return '';
  const p = getParts(dt);
  return `${String(p.day).padStart(2, '0')} ${RU_MONTHS_GEN[p.month - 1]} ${p.year} г.`;
}

/** d месяц yyyy года — e.g. 20 мая 2026 года */
export function ruWordsDate(d?: string | Date | null): string {
  const dt = asDate(d);
  if (!dt) return '';
  const p = getParts(dt);
  return `${p.day} ${RU_MONTHS_GEN[p.month - 1]} ${p.year} года`;
}

/** dd.MM.yyyy HH:mm — e.g. 20.05.2026 14:30 */
export function dotDateTime(d?: string | Date | null): string {
  const dt = asDate(d);
  if (!dt) return '';
  const p = getParts(dt);
  return `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}
