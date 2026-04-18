/**
 * Centralized display formatter for form field labels.
 *
 * RULES:
 * - Used for DISPLAY only. Never mutate stored data.
 * - Technical type (boolean/select/...) MUST NEVER be appended to user-visible label.
 * - Legacy data may have type encoded as a trailing "(type)" suffix in the stored
 *   label — strip it on render only.
 */

export interface FieldLike {
  label?: string | null;
  type?: string | null;
}

/**
 * List of recognized technical type tokens that may have leaked into a label
 * as a trailing suffix in legacy data. Matched case-insensitively, with
 * tolerance for hyphens / underscores / spaces inside the token.
 */
const TECHNICAL_TOKENS = [
  "boolean",
  "multiselect",
  "multi-select",
  "multi_select",
  "select",
  "date",
  "datetime",
  "number",
  "file single",
  "file-single",
  "file_single",
  "file multi",
  "file-multi",
  "file_multi",
  "file",
  "textarea",
  "text",
  "email",
  "phone",
  "tel",
  "password",
  "url",
];

// Build a single regex that matches " (token)" optionally repeated at the end
// of the string. Tokens are case-insensitive. Repeats handled by the outer +.
const SUFFIX_REGEX = new RegExp(
  `(?:\\s*\\((?:${TECHNICAL_TOKENS
    .map((t) => t.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"))
    .join("|")})\\)\\s*)+$`,
  "i",
);

/**
 * Strip technical type suffixes like "(boolean)", "(select)", "(file multi)"
 * from the END of a label only. Does not touch text in the middle of the label.
 *
 * Examples:
 *   "Согласие (boolean)"    → "Согласие"
 *   "Файлы (file multi)"    → "Файлы"
 *   "Город (Select)"        → "Город"
 *   "Поле(boolean)"         → "Поле"
 *   "Город (boolean) (text)"→ "Город"
 *   "Acme (Inc)"            → "Acme (Inc)"   ← unrelated, not stripped
 */
export function stripTechnicalSuffix(label: string | null | undefined): string {
  if (!label) return "";
  return label.replace(SUFFIX_REGEX, "").trimEnd();
}

/**
 * Return user-facing display label for a form field.
 * - Strips legacy technical suffixes.
 * - Falls back to "Поле N" when label is empty.
 * - NEVER appends field.type to the visible text.
 */
export function getFieldDisplayLabel(field: FieldLike, index: number): string {
  const cleaned = stripTechnicalSuffix(field?.label ?? "").trim();
  if (cleaned) return cleaned;
  return `Поле ${index + 1}`;
}
