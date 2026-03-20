/**
 * Single source of truth for UNP normalization.
 */

/** Normalize UNP: trim, strip non-digits. Returns null if empty. */
export function normalizeUnp(raw: string): string | null {
  const digits = raw.trim().replace(/\D/g, "");
  return digits.length === 0 ? null : digits;
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
