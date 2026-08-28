import { formatInTimeZone } from "date-fns-tz";
import { ru } from "date-fns/locale";

const DEFAULT_EVENT_TIMEZONE = "Europe/Minsk";

export function formatLiveEventDate(
  scheduledAt: string,
  eventTimezone = DEFAULT_EVENT_TIMEZONE,
): string {
  const date = new Date(scheduledAt);

  if (Number.isNaN(date.getTime())) return "—";

  try {
    return formatInTimeZone(date, eventTimezone, "dd MMMM yyyy, HH:mm", { locale: ru });
  } catch {
    return "—";
  }
}
