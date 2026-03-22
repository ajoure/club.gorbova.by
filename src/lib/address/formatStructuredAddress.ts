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
  if (country && /беларус/i.test(country)) return true;
  // Fallback: if city is Minsk, it's always Belarus
  if (isMinsk(structured.city)) return true;
  return false;
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

/**
 * Determine if a district is a city-internal district (e.g. "Фрунзенский район")
 * vs an oblast-level district (e.g. "Лидский район").
 * Conservative: only hide if district clearly derives from the city name.
 */
function isCityDistrict(district: string | null | undefined, city: string | null | undefined): boolean {
  if (!district || !city) return false;
  const normalizedCity = city.replace(/^(г\.|город|гор\.)\s*/i, '').trim();
  if (!normalizedCity || normalizedCity.length < 3) return false;
  // Build a root from city name (e.g. "Минск" → "Минс", "Брест" → "Брес")
  const cityRoot = normalizedCity.slice(0, Math.max(3, normalizedCity.length - 1));
  return new RegExp(cityRoot, 'i').test(district);
}

/** Build 2-line Belarus address: [street line, location line] */
function formatBelarusAddress(structured: CanonicalAddressPayload): string[] {
  const minskAddr = isMinsk(structured.city);

  // Line 1: street, house, building, apartment
  const line1Parts: string[] = [];
  if (structured.street) line1Parts.push(structured.street);
  if (structured.house) line1Parts.push(`д. ${structured.house}`);
  if (structured.building) line1Parts.push(`корп. ${structured.building}`);
  if (structured.apartment) line1Parts.push(`пом. ${structured.apartment}`);

  // Line 2: postal_code, [region, district], city/settlement
  const line2Parts: string[] = [];
  if (structured.postal_code) line2Parts.push(structured.postal_code);

  if (!minskAddr) {
    if (structured.region) {
      const region = structured.region
        .replace(/\s*область$/i, '')
        .replace(/\s*обл\.?$/i, '');
      line2Parts.push(`${region} обл.`);
    }
    if (structured.district && !isCityDistrict(structured.district, structured.city)) {
      const district = structured.district
        .replace(/\s*район$/i, '')
        .replace(/\s*р-н\.?$/i, '');
      line2Parts.push(`${district} р-н`);
    }
  }

  if (structured.city) {
    line2Parts.push(formatLocality(structured.city));
  }
  if (structured.settlement && structured.settlement !== structured.city) {
    line2Parts.push(structured.settlement);
  }

  const line1 = line1Parts.join(', ');
  const line2 = line2Parts.join(', ');

  return [line1, line2].filter(Boolean);
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
 * Format a structured address for display.
 * Belarus: 2-line format [street line, location line].
 * Generic: single-line format.
 */
export function formatStructuredAddressForView(
  structured: CanonicalAddressPayload | null | undefined,
  fallback?: string | null
): string[] {
  if (!structured) {
    return fallback ? [fallback] : [];
  }

  if (isBelarus(structured)) {
    const lines = formatBelarusAddress(structured);
    if (lines.length === 0) {
      const fb = structured.formatted_address || structured.raw_input || fallback;
      return fb ? [fb] : [];
    }
    return lines;
  }

  const result = formatGenericAddress(structured);
  if (!result) {
    const fb = structured.formatted_address || structured.raw_input || fallback;
    return fb ? [fb] : [];
  }
  return [result];
}
