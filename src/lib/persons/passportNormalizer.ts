/**
 * passportNormalizer — normalizes passport input to canonical A-Z0-9 format.
 *
 * Rules:
 * - trim, uppercase
 * - safe transliteration of visually-identical Cyrillic → Latin (М→M, А→A, etc.)
 * - remove spaces, hyphens, invisible characters
 * - retain only A-Z0-9
 * - final regex: /^[A-Z0-9]+$/
 */

/** Cyrillic letters that have visually identical Latin equivalents */
const CYRILLIC_TO_LATIN: Record<string, string> = {
  'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'К': 'K',
  'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X',
  // lowercase mapped too (will be uppercased first, but just in case)
  'а': 'A', 'в': 'B', 'с': 'C', 'е': 'E', 'н': 'H', 'к': 'K',
  'м': 'M', 'о': 'O', 'р': 'P', 'т': 'T', 'х': 'X',
};

export interface PassportNormalizationResult {
  normalized: string;
  success: boolean;
  /** Original input after trim */
  original: string;
}

/**
 * Normalize a passport string to canonical format.
 * Returns success=false if the result doesn't match /^[A-Z0-9]+$/ or is empty.
 */
export function normalizePassport(input: string): PassportNormalizationResult {
  const original = input.trim();
  if (!original) {
    return { normalized: '', success: true, original };
  }

  // Step 1: uppercase
  let val = original.toUpperCase();

  // Step 2: transliterate safe Cyrillic → Latin
  val = val.split('').map(ch => CYRILLIC_TO_LATIN[ch] || ch).join('');

  // Step 3: remove spaces, hyphens, invisible chars — retain only A-Z0-9
  val = val.replace(/[^A-Z0-9]/g, '');

  // Step 4: validate
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
