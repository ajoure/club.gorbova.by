/**
 * Card brand normalization utilities
 */

const BRAND_ALIASES: Record<string, string> = {
  'master': 'mastercard',
  'mc': 'mastercard',
  'mastercard': 'mastercard',
  'visa': 'visa',
  'belkart': 'belkart',
  'maestro': 'maestro',
  'mir': 'mir',
};

/**
 * Normalize card brand to standard format
 * Examples: 'master' -> 'mastercard', 'MC' -> 'mastercard'
 */
export function normalizeBrand(brand: string | null | undefined): string {
  if (!brand) return '';
  const lower = brand.toLowerCase().trim();
  return BRAND_ALIASES[lower] || lower;
}

/**
 * Format card display (e.g., "*3114 Mastercard")
 */
export function formatCardDisplay(last4: string, brand: string): string {
  const normalizedBrand = normalizeBrand(brand);
  const displayBrand = normalizedBrand.charAt(0).toUpperCase() + normalizedBrand.slice(1);
  return `*${last4} ${displayBrand}`;
}

/**
 * Available card brands for selection
 */
export const CARD_BRANDS = [
  { value: 'visa', label: 'Visa' },
  { value: 'mastercard', label: 'Mastercard' },
  { value: 'belkart', label: 'Belkart' },
  { value: 'maestro', label: 'Maestro' },
  { value: 'mir', label: 'МИР' },
] as const;
