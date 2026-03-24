/**
 * passportNormalizer — normalizes passport input to canonical A-Z0-9 format.
 *
 * Rules:
 * - trim, uppercase
 * - remove spaces, hyphens, invisible characters
 * - NO Cyrillic transliteration — Cyrillic input is rejected
 * - retain only A-Z0-9
 * - final regex: /^[A-Z0-9]+$/
 */

export interface PassportNormalizationResult {
  normalized: string;
  success: boolean;
  /** Original input after trim */
  original: string;
}

/** Check if string contains any Cyrillic characters */
export function containsCyrillic(value: string): boolean {
  return /[\u0400-\u04FF]/.test(value);
}

/**
 * Normalize a passport string to canonical format.
 * Returns success=false if the result doesn't match /^[A-Z0-9]+$/ or is empty,
 * or if the input contains Cyrillic characters.
 */
export function normalizePassport(input: string): PassportNormalizationResult {
  const original = input.trim();
  if (!original) {
    return { normalized: '', success: true, original };
  }

  // Reject Cyrillic — no silent transliteration
  if (containsCyrillic(original)) {
    return { normalized: '', success: false, original };
  }

  // Step 1: uppercase
  let val = original.toUpperCase();

  // Step 2: remove spaces, hyphens, invisible chars — retain only A-Z0-9
  val = val.replace(/[^A-Z0-9]/g, '');

  // Step 3: validate
  const success = val.length > 0 && /^[A-Z0-9]+$/.test(val);

  return { normalized: val, success, original };
}

/**
 * Check if a passport value is already in canonical format.
 */
export function isCanonicalPassport(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[A-Z0-9]+$/.test(value);
}
