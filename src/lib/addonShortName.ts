/**
 * Короткое имя аддона для UI-выбора.
 *
 * Источник — full name из composable quote, например:
 *   "Ценный бухгалтер | 1 ступень 2.0 | Модуль: Строительство"
 *   "Ценный бухгалтер | Модуль Маркетплейсы"
 *   "Посредничество"
 *
 * Правила:
 *   1) Разделяем по "|", берём последний непустой сегмент.
 *   2) Убираем префикс "Модуль:" / "Модуль ".
 *   3) Если один сегмент — возвращаем как есть (trim).
 *   4) Никогда не возвращаем пустую строку — фолбэк на исходное имя.
 */
export function getAddonShortName(fullName: string | null | undefined): string {
  const raw = (fullName ?? "").trim();
  if (!raw) return "";
  const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);
  const tail = parts.length > 0 ? parts[parts.length - 1] : raw;
  const stripped = tail.replace(/^Модуль\s*[:\-–]?\s*/i, "").trim();
  return stripped || tail || raw;
}

/**
 * Вторичная строка (короткое имя тарифа модуля), только если реально
 * несёт информацию и не дублирует short name.
 */
export function getAddonSecondaryLine(
  tariffName: string | null | undefined,
  shortName: string,
): string | null {
  const t = (tariffName ?? "").trim();
  if (!t) return null;
  if (t.toLowerCase() === shortName.toLowerCase()) return null;
  // если тариф — это просто "Основной"/"1 ступень" и т.п., оставляем
  return t;
}
