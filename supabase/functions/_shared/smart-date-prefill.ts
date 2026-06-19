// ============================================================================
// smart-date-prefill.ts — Deno mirror of src/lib/packageFields/smartDate.ts
// (Stage 0.3 readiness alignment).
//
// SOT логики prefill — `src/lib/packageFields/smartDate.ts`. Этот модуль
// дословно повторяет правила, чтобы edge-генератор и UI readiness считали
// smart-date значения одинаково. Изменения в одном файле обязаны быть
// зеркалированы в другом (см. proof package_field_readiness_smart_date_prefill_fix.md).
// ============================================================================

export type SmartDateKind =
  | 'none'
  | 'today'
  | 'tomorrow'
  | 'yesterday'
  | 'first_day_of_week'
  | 'last_day_of_week'
  | 'first_day_of_month'
  | 'last_day_of_month'
  | 'first_day_of_quarter'
  | 'last_day_of_quarter'
  | 'first_day_of_year'
  | 'last_day_of_year'
  | 'first_day_of_prev_month'
  | 'last_day_of_prev_month'
  | 'first_day_of_next_month'
  | 'last_day_of_next_month'
  | 'first_day_of_prev_quarter'
  | 'last_day_of_prev_quarter'
  | 'first_day_of_next_quarter'
  | 'last_day_of_next_quarter'
  | 'prev_year'
  | 'current_year'
  | 'next_year'
  | 'session_created_date'
  | 'generation_date';

export type SmartDateDataType = 'date' | 'datetime' | 'year' | string;

const ORG_TIMEZONE = 'Europe/Minsk';

function nowInTz(tz: string = ORG_TIMEZONE): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? '00';
  return new Date(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    Number(get('second')),
  );
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function fmtDatetimeStart(d: Date): string { return `${fmtDate(d)}T00:00:00.000`; }
function fmtDatetimeEnd(d: Date): string { return `${fmtDate(d)}T23:59:59.999`; }

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  const dow = (r.getDay() + 6) % 7;
  r.setDate(r.getDate() - dow);
  return r;
}
function endOfWeek(d: Date): Date {
  const r = startOfWeek(d);
  r.setDate(r.getDate() + 6);
  return r;
}

const START_ANCHORS = new Set<SmartDateKind>([
  'today', 'tomorrow', 'yesterday',
  'first_day_of_week',
  'first_day_of_month', 'first_day_of_quarter', 'first_day_of_year',
  'first_day_of_prev_month', 'first_day_of_next_month',
  'first_day_of_prev_quarter', 'first_day_of_next_quarter',
  'session_created_date', 'generation_date',
]);
const END_ANCHORS = new Set<SmartDateKind>([
  'last_day_of_week',
  'last_day_of_month', 'last_day_of_quarter', 'last_day_of_year',
  'last_day_of_prev_month', 'last_day_of_next_month',
  'last_day_of_prev_quarter', 'last_day_of_next_quarter',
]);
const YEAR_KINDS = new Set<SmartDateKind>(['prev_year', 'current_year', 'next_year']);

export interface SmartDateContext {
  sessionCreatedAt?: string | null;
  generationDate?: string | null;
  timezone?: string;
  dataType?: SmartDateDataType;
}

function resolveAnchorDate(kind: SmartDateKind, today: Date, ctx: SmartDateContext): Date | null {
  const Y = today.getFullYear();
  const M = today.getMonth();
  const Q = Math.floor(M / 3) * 3;
  switch (kind) {
    case 'today': return today;
    case 'tomorrow': { const d = new Date(today); d.setDate(d.getDate() + 1); return d; }
    case 'yesterday': { const d = new Date(today); d.setDate(d.getDate() - 1); return d; }
    case 'first_day_of_week': return startOfWeek(today);
    case 'last_day_of_week': return endOfWeek(today);
    case 'first_day_of_month': return new Date(Y, M, 1);
    case 'last_day_of_month': return new Date(Y, M + 1, 0);
    case 'first_day_of_prev_month': return new Date(Y, M - 1, 1);
    case 'last_day_of_prev_month': return new Date(Y, M, 0);
    case 'first_day_of_next_month': return new Date(Y, M + 1, 1);
    case 'last_day_of_next_month': return new Date(Y, M + 2, 0);
    case 'first_day_of_quarter': return new Date(Y, Q, 1);
    case 'last_day_of_quarter': return new Date(Y, Q + 3, 0);
    case 'first_day_of_prev_quarter': return new Date(Y, Q - 3, 1);
    case 'last_day_of_prev_quarter': return new Date(Y, Q, 0);
    case 'first_day_of_next_quarter': return new Date(Y, Q + 3, 1);
    case 'last_day_of_next_quarter': return new Date(Y, Q + 6, 0);
    case 'first_day_of_year': return new Date(Y, 0, 1);
    case 'last_day_of_year': return new Date(Y, 11, 31);
    case 'session_created_date':
      if (!ctx.sessionCreatedAt) return null;
      return new Date(ctx.sessionCreatedAt);
    case 'generation_date':
      return ctx.generationDate ? new Date(ctx.generationDate) : today;
    default:
      return null;
  }
}

export function resolveSmartDatePrefill(
  kind: SmartDateKind | undefined | null,
  ctx: SmartDateContext = {},
): string | null {
  if (!kind || kind === 'none') return null;
  const tz = ctx.timezone ?? ORG_TIMEZONE;
  const today = nowInTz(tz);
  if (YEAR_KINDS.has(kind as SmartDateKind)) {
    const Y = today.getFullYear();
    if (kind === 'prev_year') return String(Y - 1);
    if (kind === 'current_year') return String(Y);
    if (kind === 'next_year') return String(Y + 1);
    return null;
  }
  const d = resolveAnchorDate(kind as SmartDateKind, today, ctx);
  if (!d || isNaN(d.getTime())) return null;
  if (ctx.dataType === 'datetime') {
    if (END_ANCHORS.has(kind as SmartDateKind)) return fmtDatetimeEnd(d);
    if (START_ANCHORS.has(kind as SmartDateKind)) return fmtDatetimeStart(d);
    return fmtDatetimeStart(d);
  }
  return fmtDate(d);
}

/**
 * Strict validator: prefill значение считается заполненным ТОЛЬКО если оно
 * соответствует ожидаемому формату для data_type.
 *   - year     → 4 цифры, год >= 1000
 *   - date     → YYYY-MM-DD, парсится в валидную дату с теми же Y/M/D
 *   - datetime → YYYY-MM-DDTHH:mm:ss(.sss)?, валидный
 *   - прочие   → false (smart-date не применим)
 */
export function isValidSmartDatePrefill(
  value: string | null | undefined,
  dataType: SmartDateDataType | undefined,
): boolean {
  if (value == null) return false;
  const s = String(value).trim();
  if (s === '') return false;
  if (dataType === 'year') {
    if (!/^\d{4}$/.test(s)) return false;
    const n = Number(s);
    return Number.isFinite(n) && n >= 1000 && n <= 9999;
  }
  if (dataType === 'date') {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const Y = Number(m[1]), Mo = Number(m[2]), D = Number(m[3]);
    if (Mo < 1 || Mo > 12 || D < 1 || D > 31) return false;
    const d = new Date(Y, Mo - 1, D);
    return d.getFullYear() === Y && d.getMonth() === Mo - 1 && d.getDate() === D;
  }
  if (dataType === 'datetime') {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?$/);
    if (!m) return false;
    const Y = Number(m[1]), Mo = Number(m[2]), D = Number(m[3]);
    const h = Number(m[4]), mi = Number(m[5]), se = Number(m[6]);
    if (Mo < 1 || Mo > 12 || D < 1 || D > 31) return false;
    if (h > 23 || mi > 59 || se > 59) return false;
    const d = new Date(Y, Mo - 1, D, h, mi, se);
    return d.getFullYear() === Y && d.getMonth() === Mo - 1 && d.getDate() === D;
  }
  return false;
}
