/**
 * formatStructuredAddress — reusable address formatter for view-mode.
 *
 * Returns a single display string per product standard.
 *
 * Belarus (BY) rules:
 * - Minsk: skip country, region, district → "220018, г. Минск, ул. Одинцова, д. 19, кв. 306"
 * - Other BY: skip country, skip district, show region → "231300, Гродненская обл., г. Лида, ул. ..."
 * - Settlement type prefixes preserved if present (г., аг., д., п., г.п.)
 *
 * Non-Belarus: generic formatting with all segments.
 */

import type { CanonicalAddressPayload } from '@/lib/address/types';

/** Normalize city name for Minsk detection */
function isMinsk(city: string | null | undefined): boolean {
  if (!city) return false;
  const normalized = city
    .replace(/^(г\.|город|гор\.)\s*/i, '')
    .trim();
  return normalized === 'Минск';
}

/** Check if address is in Belarus */
function isBelarus(structured: CanonicalAddressPayload): boolean {
  const code = (structured as any).country_code;
  if (code && code.toUpperCase() === 'BY') return true;
  const country = structured.country;
  if (!country) return false;
  return /беларус/i.test(country);
}

/** Format city/settlement with type prefix if not already present */
function formatLocality(city: string | null | undefined): string {
  if (!city) return '';
  // If already has a prefix (г., аг., д., п., г.п.), return as-is
  if (/^(г\.|аг\.|д\.|п\.|г\.п\.|город|гор\.|пос\.)\s/i.test(city)) {
    return city;
  }
  // For standalone names, add "г." for city context
  return `г. ${city}`;
}

/** Build single-line Belarus address */
function formatBelarusAddress(structured: CanonicalAddressPayload): string {
  const parts: string[] = [];
  const minskAddr = isMinsk(structured.city);

  // 1. Postal code
  if (structured.postal_code) parts.push(structured.postal_code);

  // 2. Region (skip for Minsk)
  if (!minskAddr && structured.region) {
    const region = structured.region
      .replace(/\s*область$/i, '')
      .replace(/\s*обл\.?$/i, '');
    parts.push(`${region} обл.`);
  }

  // 3. City
  if (structured.city) {
    parts.push(formatLocality(structured.city));
  }

  // 4. Settlement (if different from city)
  if (structured.settlement && structured.settlement !== structured.city) {
    parts.push(structured.settlement);
  }

  // 5. Street
  if (structured.street) parts.push(structured.street);

  // 6. House
  if (structured.house) parts.push(`д. ${structured.house}`);

  // 7. Building
  if (structured.building) parts.push(`корп. ${structured.building}`);

  // 8. Apartment
  if (structured.apartment) parts.push(`пом. ${structured.apartment}`);

  return parts.join(', ');
}

/** Build single-line generic address */
function formatGenericAddress(structured: CanonicalAddressPayload): string {
  const parts: string[] = [];

  if (structured.country) parts.push(structured.country);
  if (structured.postal_code) parts.push(structured.postal_code);
  if (structured.region) parts.push(structured.region);
  if (structured.district) parts.push(structured.district);
  if (structured.city) parts.push(structured.city);
  if (structured.settlement && structured.settlement !== structured.city) {
    parts.push(structured.settlement);
  }
  if (structured.street) parts.push(structured.street);
  if (structured.house) parts.push(`д. ${structured.house}`);
  if (structured.building) parts.push(`корп. ${structured.building}`);
  if (structured.apartment) parts.push(`пом. ${structured.apartment}`);

  return parts.join(', ');
}

/**
 * Format a structured address into a single display string.
 * Returns array with one element for backward compatibility.
 */
export function formatStructuredAddressForView(
  structured: CanonicalAddressPayload | null | undefined,
  fallback?: string | null
): string[] {
  if (!structured) {
    return fallback ? [fallback] : [];
  }

  let result: string;

  if (isBelarus(structured)) {
    result = formatBelarusAddress(structured);
  } else {
    result = formatGenericAddress(structured);
  }

  // If no useful segments, fall back
  if (!result) {
    const fb = structured.formatted_address || structured.raw_input || fallback;
    return fb ? [fb] : [];
  }

  return [result];
}
