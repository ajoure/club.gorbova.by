/**
 * Единый визуальный контракт «CRM action button» для карточек сделки,
 * контакта и компании.
 *
 * Все inline-кнопки в шапках/секциях каналов связи (Позвонить, SMS, Письмо,
 * Telegram, Instagram) должны использовать эти токены, чтобы сохранить
 * консистентный компактный вид: высота 28px (`h-7`), горизонтальный
 * padding 10px (`px-2.5`), 12px шрифт (`text-xs`), иконка 12px (`h-3 w-3`).
 *
 * Не хардкодить цвет — только семантические токены из variant (`outline`,
 * `ghost`, `default`). Иконку компактно префиксовать через `crmActionIconClass`.
 */
export const crmActionBtnClass = "h-7 px-2.5 text-xs";
export const crmActionIconClass = "h-3 w-3 mr-1";
export const crmActionIconOnlyClass = "h-7 w-7";
