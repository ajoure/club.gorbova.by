/**
 * smartDate — PATCH-PACKAGE-CUSTOM-FIELDS-V1.
 *
 * Прероллинг значений по умолчанию для date/datetime/year полей пакета.
 * Расчёт в timezone организации (canonical: Europe/Minsk).
 *
 * smart-date — это НЕ data_type, а вычисляемый prefill в анкете. Значение
 * становится фактическим session_field_value только после сохранения формы
 * клиентом или администратором.
 */
import type { SmartDateKind } from "@/hooks/usePackageFieldCatalog";

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

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}

function endOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3 + 3, 0);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

function endOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 11, 31);
}

export interface SmartDateContext {
  /** ISO дата создания сессии (для session_created_date). */
  sessionCreatedAt?: string | null;
  /** ISO дата генерации (для generation_date). Если нет — берётся текущее время. */
  generationDate?: string | null;
  timezone?: string;
}

/**
 * Возвращает ISO-дату (YYYY-MM-DD) для prefill. Если kind не применим — null.
 */
export function resolveSmartDatePrefill(
  kind: SmartDateKind | undefined | null,
  ctx: SmartDateContext = {},
): string | null {
  if (!kind || kind === "none") return null;
  const tz = ctx.timezone ?? ORG_TIMEZONE;
  const today = nowInTz(tz);
  switch (kind) {
    case "today":
      return fmtDate(today);
    case "tomorrow": {
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      return fmtDate(d);
    }
    case "yesterday": {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return fmtDate(d);
    }
    case "first_day_of_week":
      return fmtDate(startOfWeek(today));
    case "last_day_of_week":
      return fmtDate(endOfWeek(today));
    case "first_day_of_month":
      return fmtDate(startOfMonth(today));
    case "last_day_of_month":
      return fmtDate(endOfMonth(today));
    case "first_day_of_quarter":
      return fmtDate(startOfQuarter(today));
    case "last_day_of_quarter":
      return fmtDate(endOfQuarter(today));
    case "first_day_of_year":
      return fmtDate(startOfYear(today));
    case "last_day_of_year":
      return fmtDate(endOfYear(today));
    case "session_created_date":
      if (!ctx.sessionCreatedAt) return null;
      return fmtDate(new Date(ctx.sessionCreatedAt));
    case "generation_date":
      return fmtDate(ctx.generationDate ? new Date(ctx.generationDate) : today);
    default:
      return null;
  }
}

export const SMART_DATE_KIND_LABELS: Record<SmartDateKind, string> = {
  none: "Без значения по умолчанию",
  today: "Сегодня",
  tomorrow: "Завтра",
  yesterday: "Вчера",
  first_day_of_week: "Понедельник текущей недели",
  last_day_of_week: "Воскресенье текущей недели",
  first_day_of_month: "Первый день месяца",
  last_day_of_month: "Последний день месяца",
  first_day_of_quarter: "Первый день квартала",
  last_day_of_quarter: "Последний день квартала",
  first_day_of_year: "Первый день года",
  last_day_of_year: "Последний день года",
  session_created_date: "Дата создания анкеты",
  generation_date: "Дата генерации документа",
};
