/**
 * Single source of truth for UNP normalization.
 */

/** Normalize UNP: trim, strip non-digits. Returns null if empty. */
export function normalizeUnp(raw: string): string | null {
  const digits = raw.trim().replace(/\D/g, "");
  return digits.length === 0 ? null : digits;
}

/**
 * Normalize browser input without rejecting a pasted formatted UNP.
 *
 * The registry accepts exactly nine digits. Keeping this separate from
 * `normalizeUnp` lets forms remove spaces, dashes and other separators while
 * the person is typing, and prevents `maxLength` from truncating a formatted
 * value before it can be normalized.
 */
export function normalizeUnpInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 9);
}

/** Check if normalized UNP is exactly 9 digits */
export function isValidUnp(raw: string): boolean {
  const normalized = normalizeUnp(raw);
  return normalized !== null && normalized.length === 9;
}

/** Normalize and validate: returns 9-digit string or null */
export function normalizeAndValidateUnp(raw: string): string | null {
  const normalized = normalizeUnp(raw);
  return normalized?.length === 9 ? normalized : null;
}
