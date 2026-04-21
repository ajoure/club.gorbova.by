/**
 * Sprint B: helper для TZ-лейблов в UI (selector + room header / pre-show).
 *
 * Правило (зафиксировано в плане Sprint B):
 *   - всегда показываем старт в TZ зрителя
 *   - если viewer_tz !== event_tz → компактный второй лейбл с TZ эфира
 *   - если совпадают → второй лейбл скрыт
 */

export interface DualTzLabel {
  primary: string;     // в TZ зрителя
  secondary: string | null; // в TZ эфира (если отличается)
  viewerTz: string;
  eventTz: string;
}

export function formatDualTz(args: {
  iso: string;
  viewerTz: string;
  eventTz: string;
  locale?: string;
}): DualTzLabel {
  const { iso, viewerTz, eventTz, locale = "ru-RU" } = args;
  const date = new Date(iso);

  const fmt = (tz: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);

  const primary = fmt(viewerTz);
  const secondary = viewerTz === eventTz ? null : fmt(eventTz);

  return { primary, secondary, viewerTz, eventTz };
}
