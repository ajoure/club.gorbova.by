/**
 * parseStreetInput — conservative fallback parser for extracting
 * house number and apartment from a street input string.
 *
 * Only fires when Google did NOT return subpremise/apartment.
 * NOT used in UNP/GRP enrichment path.
 *
 * Supported patterns (tail of string only):
 *   "Одинцова 19-306"      → street=Одинцова, house=19, apartment=306
 *   "Одинцова 19 кв 306"   → street=Одинцова, house=19, apartment=306
 *   "Одинцова 19 кв. 306"  → street=Одинцова, house=19, apartment=306
 *   "Одинцова 19, кв 306"  → street=Одинцова, house=19, apartment=306
 *   "Одинцова 19 пом 306"  → street=Одинцова, house=19, apartment=306
 *   "Одинцова 19 офис 306" → street=Одинцова, house=19, apartment=306
 *   "Одинцова 19"           → street=Одинцова, house=19
 *   "Одинцова"              → street=Одинцова (no change)
 *
 * Safety rules:
 * - Dash pattern (19-306) only when dash is at the tail after a house number
 * - Street names with dashes (e.g. "Карла-Маркса") are NOT broken
 * - If no confident match — returns input unchanged
 */

export interface ParsedStreetInput {
  street: string;
  house?: string;
  apartment?: string;
}

/**
 * Try to extract house and apartment from a street string.
 * Returns parsed result only if confident; otherwise returns { street: input }.
 */
export function parseStreetInput(input: string): ParsedStreetInput {
  const trimmed = input.trim();
  if (!trimmed) return { street: '' };

  // Pattern 1: "... 19 кв. 306" / "... 19, кв 306" / "... 19 кв 306"
  const kvMatch = trimmed.match(
    /^(.+?)\s+(\d+[а-яА-Яa-zA-Z]?)\s*,?\s*(?:кв\.?|квартира|пом\.?|помещение|оф\.?|офис)\s*([\wа-яА-Я-]+)\s*$/i
  );
  if (kvMatch) {
    return {
      street: kvMatch[1].trim(),
      house: kvMatch[2],
      apartment: kvMatch[3],
    };
  }

  // Pattern 2: "... 19-306" — dash between two numbers at the tail
  // Must ensure the dash is NOT part of the street name
  // Strategy: the number before dash must be preceded by whitespace (separating it from street name)
  const dashMatch = trimmed.match(
    /^(.+?)\s+(\d+[а-яА-Яa-zA-Z]?)\s*[-–—]\s*([\wа-яА-Я]+)\s*$/
  );
  if (dashMatch) {
    return {
      street: dashMatch[1].trim(),
      house: dashMatch[2],
      apartment: dashMatch[3],
    };
  }

  // No apartment pattern found — return unchanged
  return { street: trimmed };
}

/**
 * Strip common apartment/room prefixes from a value.
 * "кв. 4" → "4", "пом. 49л" → "49л", "офис 12" → "12"
 * Prefix-only: only removes from the start of the string.
 */
export function stripApartmentPrefix(value: string): string {
  if (!value) return value;
  return value.replace(/^(кв\.?|квартира|пом\.?|помещение|оф\.?|офис)\s*/i, '').trim();
}
