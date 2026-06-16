/**
 * extractPfTokens — общий парсер pf-XXXXXX из произвольного списка
 * "inside-токенов" (то, что лежит между {{ и }}). Используется в
 * read-only панелях документов пакета и в резолвере анкеты клиента.
 *
 * Канон: pf-токен — строго `pf-XXXXXX` (6 цифр), модификаторы
 * (`|format=...`, `|case=...`) допускаются и игнорируются.
 *
 * Источник истины токенов шаблона — `document_template_versions.detected_tokens`
 * (jsonb-массив строк) активной версии (`is_current=true`).
 */

/** Точный pf-public_id, либо null. */
export function parsePfPublicId(inside: unknown): string | null {
  if (typeof inside !== "string") return null;
  const trimmed = inside.trim();
  // Отрезаем модификаторы вида |format=...
  const base = trimmed.split("|")[0]?.trim() ?? "";
  const m = /^(pf-\d{6})$/.exec(base);
  return m ? m[1] : null;
}

/** Уникальные pf-public_ids в порядке первого появления. */
export function extractPfPublicIds(tokens: unknown): string[] {
  if (!Array.isArray(tokens)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const id = parsePfPublicId(t);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
