/**
 * formatStructuredAddress — reusable address formatter for view-mode.
 *
 * Returns an array of non-empty address lines for multi-line display.
 * Used in EntityViewSheet (ЮЛ/ИП) and PersonViewSheet (физлица in PATCH 6).
 */

import type { CanonicalAddressPayload } from '@/lib/address/types';

/**
 * Format a structured address into readable lines for display.
 * Skips empty segments, groups logically.
 */
export function formatStructuredAddressForView(
  structured: CanonicalAddressPayload | null | undefined,
  fallback?: string | null
): string[] {
  if (!structured) {
    return fallback ? [fallback] : [];
  }

  const lines: string[] = [];

  // Line 1: Country, region, district
  const geo = [structured.country, structured.region, structured.district]
    .filter(Boolean)
    .join(', ');
  if (geo) lines.push(geo);

  // Line 2: City / settlement
  const locality = [structured.city, structured.settlement]
    .filter(Boolean)
    .join(', ');
  if (locality) lines.push(locality);

  // Line 3: Street, house, building, apartment
  const parts: string[] = [];
  if (structured.street) parts.push(structured.street);
  if (structured.house) parts.push(`д. ${structured.house}`);
  if (structured.building) parts.push(`корп. ${structured.building}`);
  if (structured.apartment) parts.push(`кв./оф. ${structured.apartment}`);
  if (parts.length > 0) lines.push(parts.join(', '));

  // Line 4: Postal code
  if (structured.postal_code) lines.push(structured.postal_code);

  // If structured had no useful segments, fall back to formatted_address or raw_input
  if (lines.length === 0) {
    const fb = structured.formatted_address || structured.raw_input || fallback;
    if (fb) lines.push(fb);
  }

  return lines;
}
