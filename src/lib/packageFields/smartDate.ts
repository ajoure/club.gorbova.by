/**
 * smartDate — PATCH-PACKAGE-CUSTOM-FIELDS-V1 (итерация 2).
 *
 * Прероллинг значений по умолчанию для date / datetime / year полей пакета.
 * Расчёт в timezone организации (canonical: Europe/Minsk).
 *
 * smart-date — это НЕ data_type, а вычисляемый prefill в анкете. Значение
 * становится фактическим session_field_value только после сохранения формы
 * клиентом или администратором. Бекенд НИКОГДА не пересчитывает kinds —
 * он лишь снапшотит строковое значение `default_kind_applied` в meta.
 *
 * Контракт datetime (итерация 2, B3):
 *   start-anchor → 00:00:00.000 (локальное время Europe/Minsk)
 *   end-anchor   → 23:59:59.999 (локальное время Europe/Minsk)
 *   формат сериализации: YYYY-MM-DDTHH:mm:ss.sss (локальная строка БЕЗ суффикса timezone),
 *   что соответствует существующему контракту session_field_value.
 *
 * Для типа `year` возвращается строка из 4 цифр (prev/current/next_year).
 *
 * Безопасные date constructors — `new Date(Y, M, D)` нормализует переходы
 * между годами; addMonths не используем.
 */
import type { SmartDateKind, PackageFieldDataType } from "@/hooks/usePackageFieldCatalog";

const ORG_TIMEZONE = "Europe/Minsk";

function nowInTz(tz: string = ORG_TIMEZONE): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "00";
  return new Date(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")),
    Number(get("minute")),
    Number(get("second")),
  );
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function fmtDatetimeStart(d: Date): string {
  return `${fmtDate(d)}T00:00:00.000`;
}

function fmtDatetimeEnd(d: Date): string {
  return `${fmtDate(d)}T23:59:59.999`;
}

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  const dow = (r.getDay() + 6) % 7; // Mon=0
  r.setDate(r.getDate() - dow);
  return r;
}
function endOfWeek(d: Date): Date {
  const r = startOfWeek(d);
  r.setDate(r.getDate() + 6);
  return r;
}

/** Все kinds, считающиеся "start anchor" (для datetime — 00:00:00). */
const START_ANCHORS = new Set<SmartDateKind>([
  "today",
  "tomorrow",
  "yesterday",
  "first_day_of_week",
  "first_day_of_month",
  "first_day_of_quarter",
  "first_day_of_year",
  "first_day_of_prev_month",
  "first_day_of_next_month",
  "first_day_of_prev_quarter",
  "first_day_of_next_quarter",
  "session_created_date",
  "generation_date",
]);

const END_ANCHORS = new Set<SmartDateKind>([
  "last_day_of_week",
  "last_day_of_month",
  "last_day_of_quarter",
  "last_day_of_year",
  "last_day_of_prev_month",
  "last_day_of_next_month",
  "last_day_of_prev_quarter",
  "last_day_of_next_quarter",
]);

const YEAR_KINDS = new Set<SmartDateKind>(["prev_year", "current_year", "next_year"]);

export interface SmartDateContext {
  /** ISO дата создания сессии (для session_created_date). */
  sessionCreatedAt?: string | null;
  /** ISO дата генерации (для generation_date). Если нет — берётся текущее время. */
  generationDate?: string | null;
  timezone?: string;
  /**
   * Тип поля. Влияет на формат результата:
   *   - 'year'      → "YYYY" (для prev/current/next_year)
   *   - 'datetime'  → "YYYY-MM-DDTHH:mm:ss.sss"
   *   - 'date' и др → "YYYY-MM-DD"
   */
  dataType?: PackageFieldDataType;
}

function resolveAnchorDate(
  kind: SmartDateKind,
  today: Date,
  ctx: SmartDateContext,
): Date | null {
  const Y = today.getFullYear();
  const M = today.getMonth(); // 0..11
  const Q = Math.floor(M / 3) * 3; // 0|3|6|9

  switch (kind) {
    case "today": return today;
    case "tomorrow": { const d = new Date(today); d.setDate(d.getDate() + 1); return d; }
    case "yesterday": { const d = new Date(today); d.setDate(d.getDate() - 1); return d; }

    case "first_day_of_week": return startOfWeek(today);
    case "last_day_of_week": return endOfWeek(today);

    case "first_day_of_month": return new Date(Y, M, 1);
    case "last_day_of_month": return new Date(Y, M + 1, 0);
    case "first_day_of_prev_month": return new Date(Y, M - 1, 1);
    case "last_day_of_prev_month":  return new Date(Y, M, 0);
    case "first_day_of_next_month": return new Date(Y, M + 1, 1);
    case "last_day_of_next_month":  return new Date(Y, M + 2, 0);

    case "first_day_of_quarter": return new Date(Y, Q, 1);
    case "last_day_of_quarter":  return new Date(Y, Q + 3, 0);
    case "first_day_of_prev_quarter": return new Date(Y, Q - 3, 1);
    case "last_day_of_prev_quarter":  return new Date(Y, Q, 0);
    case "first_day_of_next_quarter": return new Date(Y, Q + 3, 1);
    case "last_day_of_next_quarter":  return new Date(Y, Q + 6, 0);

    case "first_day_of_year": return new Date(Y, 0, 1);
    case "last_day_of_year":  return new Date(Y, 11, 31);

    case "session_created_date":
      if (!ctx.sessionCreatedAt) return null;
      return new Date(ctx.sessionCreatedAt);
    case "generation_date":
      return ctx.generationDate ? new Date(ctx.generationDate) : today;

    default:
      return null;
  }
}

/**
 * Возвращает строковое значение для prefill анкеты или null если kind не применим.
 *
 * Контракт результата:
 *   - year kinds → "YYYY"
 *   - dataType='datetime' + start anchor → "YYYY-MM-DDT00:00:00.000"
 *   - dataType='datetime' + end anchor   → "YYYY-MM-DDT23:59:59.999"
 *   - иначе                              → "YYYY-MM-DD"
 *
 * Бекенд этот резолвер НЕ вызывает — он только снапшотит строку
 * `default_kind_applied` в `tokens_snapshot[]`.
 */
export function resolveSmartDatePrefill(
  kind: SmartDateKind | undefined | null,
  ctx: SmartDateContext = {},
): string | null {
  if (!kind || kind === "none") return null;
  const tz = ctx.timezone ?? ORG_TIMEZONE;
  const today = nowInTz(tz);

  if (YEAR_KINDS.has(kind)) {
    const Y = today.getFullYear();
    if (kind === "prev_year") return String(Y - 1);
    if (kind === "current_year") return String(Y);
    if (kind === "next_year") return String(Y + 1);
    return null;
  }

  const d = resolveAnchorDate(kind, today, ctx);
  if (!d) return null;

  if (ctx.dataType === "datetime") {
    if (END_ANCHORS.has(kind)) return fmtDatetimeEnd(d);
    if (START_ANCHORS.has(kind)) return fmtDatetimeStart(d);
    return fmtDatetimeStart(d);
  }
  return fmtDate(d);
}

export const SMART_DATE_KIND_LABELS: Record<SmartDateKind, string> = {
  none: "Без значения по умолчанию",
  today: "Сегодня",
  tomorrow: "Завтра",
  yesterday: "Вчера",
  first_day_of_week: "Понедельник текущей недели",
  last_day_of_week: "Воскресенье текущей недели",
  first_day_of_month: "Первый день текущего месяца",
  last_day_of_month: "Последний день текущего месяца",
  first_day_of_quarter: "Первый день текущего квартала",
  last_day_of_quarter: "Последний день текущего квартала",
  first_day_of_year: "Первый день текущего года",
  last_day_of_year: "Последний день текущего года",
  first_day_of_prev_month: "Первый день прошлого месяца",
  last_day_of_prev_month: "Последний день прошлого месяца",
  first_day_of_next_month: "Первый день будущего месяца",
  last_day_of_next_month: "Последний день будущего месяца",
  first_day_of_prev_quarter: "Первый день прошлого квартала",
  last_day_of_prev_quarter: "Последний день прошлого квартала",
  first_day_of_next_quarter: "Первый день будущего квартала",
  last_day_of_next_quarter: "Последний день будущего квартала",
  prev_year: "Прошлый год",
  current_year: "Текущий год",
  next_year: "Будущий год",
  session_created_date: "Дата создания анкеты",
  generation_date: "Дата генерации документа",
};

/**
 * Фильтр allowed kinds по data_type (PATCH-PACKAGE-CUSTOM-FIELDS-V1 итерация 2, B4).
 * Используется UI для жёсткой фильтрации опций в Select и для авто-сброса
 * defaultKind при смене типа поля до сохранения.
 */
export function allowedSmartDateKindsForType(t: PackageFieldDataType): SmartDateKind[] {
  if (t === "year") return ["none", "prev_year", "current_year", "next_year"];
  if (t === "date" || t === "datetime") {
    return [
      "none",
      "today", "tomorrow", "yesterday",
      "first_day_of_week", "last_day_of_week",
      "first_day_of_month", "last_day_of_month",
      "first_day_of_prev_month", "last_day_of_prev_month",
      "first_day_of_next_month", "last_day_of_next_month",
      "first_day_of_quarter", "last_day_of_quarter",
      "first_day_of_prev_quarter", "last_day_of_prev_quarter",
      "first_day_of_next_quarter", "last_day_of_next_quarter",
      "first_day_of_year", "last_day_of_year",
      "session_created_date", "generation_date",
    ];
  }
  return []; // все остальные типы — селект скрыт
}

export function isSmartDateKindAllowedForType(
  k: SmartDateKind,
  t: PackageFieldDataType,
): boolean {
  return allowedSmartDateKindsForType(t).includes(k);
}
