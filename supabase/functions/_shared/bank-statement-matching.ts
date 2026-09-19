export type CounterpartyNameMatch = "match" | "mismatch" | "needs_review";

const LEGAL_FORM_TOKENS = new Set([
  "ооо", "зао", "одо", "чуп", "уп", "ип",
  "республиканское", "унитарное", "общество", "с", "ограниченной",
  "ответственностью", "дополнительной", "закрытое", "акционерное",
  "индивидуальный", "предприниматель",
]);

export function normalizeCounterpartyName(value: string | null | undefined): string {
  const normalized = (value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[«»"'`]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.split(" ").filter((token) => !LEGAL_FORM_TOKENS.has(token)).join(" ");
}

/**
 * Conservative comparison: a missing / badly extracted name is reviewable,
 * not a fraud assertion. A materially different name is marked as a mismatch.
 */
export function compareCounterpartyNames(
  statementName: string | null | undefined,
  officialName: string | null | undefined,
): CounterpartyNameMatch {
  const left = normalizeCounterpartyName(statementName);
  const right = normalizeCounterpartyName(officialName);
  if (left.length < 3 || right.length < 3) return "needs_review";
  if (left === right || left.includes(right) || right.includes(left)) return "match";

  const a = new Set(left.split(" ").filter((word) => word.length > 2));
  const b = new Set(right.split(" ").filter((word) => word.length > 2));
  if (!a.size || !b.size) return "needs_review";
  const overlap = [...a].filter((word) => b.has(word)).length;
  return overlap / Math.min(a.size, b.size) >= 0.7 ? "match" : "mismatch";
}
