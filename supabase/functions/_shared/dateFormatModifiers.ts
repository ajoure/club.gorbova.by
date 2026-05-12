/**
 * Shared date format modifiers for token resolvers.
 *
 * Supports the canonical syntax `{{...|format=<name>}}` for date-typed
 * fields (data_type = 'date' | 'datetime') and for the legacy
 * `{{document.date}}` token.
 *
 * Allowed values:
 *   - short        → dd.MM.yyyy
 *   - dd.MM.yyyy   → dd.MM.yyyy (alias of short, explicit)
 *   - long_ru      → "11 мая 2026 г."
 *   - words_ru     → "11 мая 2026 года"
 *
 * Legacy alias: {{document.date_short}} ≡ {{document.date|format=short}}.
 *
 * No new FLD-* identifiers are introduced for date variants — same FLD,
 * different modifier.
 */

export const ALLOWED_DATE_FORMATS = new Set<string>([
  'short',
  'dd.MM.yyyy',
  'long_ru',
  'words_ru',
]);

const RU_MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/**
 * Parse a date-ish value into Y/M/D parts (calendar).
 * Accepts:
 *   - ISO `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm:ss[.sss][Z|±HH:mm]`
 *   - dd.MM.yyyy
 *   - Date object / number (epoch ms)
 * Returns null when value cannot be parsed.
 */
export function parseDateParts(value: any): { y: number; m: number; d: number } | null {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    return { y: value.getUTCFullYear(), m: value.getUTCMonth() + 1, d: value.getUTCDate() };
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const dt = new Date(value);
    if (!isNaN(dt.getTime())) {
      return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
    }
  }

  const s = String(value).trim();
  if (!s) return null;

  // dd.MM.yyyy
  const dot = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dot) return { y: +dot[3], m: +dot[2], d: +dot[1] };

  // YYYY-MM-DD or YYYY-MM-DD...
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { y: +iso[1], m: +iso[2], d: +iso[3] };

  // Last-resort: Date.parse (UTC interpretation)
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }
  return null;
}

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

/**
 * Apply a date format modifier to a raw date value.
 * - Returns null if the format is unknown OR value is unparseable.
 * - Caller decides whether to fall back to base value or warn.
 */
export function applyDateFormat(value: any, format: string | null): { value: string; applied: boolean } {
  if (!format) return { value: value == null ? '' : String(value), applied: false };
  if (!ALLOWED_DATE_FORMATS.has(format)) {
    return { value: value == null ? '' : String(value), applied: false };
  }
  const parts = parseDateParts(value);
  if (!parts) return { value: value == null ? '' : String(value), applied: false };

  const { y, m, d } = parts;
  switch (format) {
    case 'short':
    case 'dd.MM.yyyy':
      return { value: `${pad2(d)}.${pad2(m)}.${y}`, applied: true };
    case 'long_ru':
      return { value: `${pad2(d)} ${RU_MONTHS_GEN[m - 1] || ''} ${y} г.`, applied: true };
    case 'words_ru':
      return { value: `${pad2(d)} ${RU_MONTHS_GEN[m - 1] || ''} ${y} года`, applied: true };
    default:
      return { value: String(value), applied: false };
  }
}

/**
 * Build all canonical-form variants of a single date value for a given key.
 * Used by legacy resolver to populate alias keys in `resolverValues`:
 *
 *   {{document.date}}
 *   {{document.date|format=short}}
 *   {{document.date|format=dd.MM.yyyy}}
 *   {{document.date|format=long_ru}}
 *   {{document.date|format=words_ru}}
 *
 * + legacy alias {{document.date_short}} → format=short
 */
export function buildDateAliasMap(baseKey: string, value: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const fmt of ALLOWED_DATE_FORMATS) {
    out[`${baseKey}|format=${fmt}`] = applyDateFormat(value, fmt).value;
  }
  return out;
}
