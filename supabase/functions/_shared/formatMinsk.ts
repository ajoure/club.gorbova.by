/**
 * Унифицированный формат даты+времени по Минску для всех уведомлений.
 * Соответствует тому, как отображается в карточке контакта.
 *
 * Пример: "3 мая в 23:59 (Минск)"
 */
export function formatMinskDateTime(input: Date | string | null | undefined): string | null {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return null;

  const dateFmt = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', timeZone: 'Europe/Minsk'
  });
  const timeFmt = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Minsk'
  });
  return `${dateFmt.format(d)} в ${timeFmt.format(d)} (Минск)`;
}

/** То же, но с годом (для email-шаблонов, где год полезен) */
export function formatMinskDateTimeWithYear(input: Date | string | null | undefined): string | null {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return null;

  const dateFmt = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Minsk'
  });
  const timeFmt = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Minsk'
  });
  return `${dateFmt.format(d)} в ${timeFmt.format(d)} (Минск)`;
}
