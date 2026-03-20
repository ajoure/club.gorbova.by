/**
 * GrpAddressParser — anti-corruption layer for MNS flat address strings.
 *
 * Parses flat address from GRP registry into StructuredAddress.
 * Typical MNS formats:
 *   "г. Минск, ул. Панфилова, д. 2, оф. 123"
 *   "222160, Минская обл., г. Жодино, ул. 50 лет Октября, д. 14"
 *   "220004, г.Минск, ул.Короля, 51"
 */

import type { StructuredAddress } from '@/lib/address/types';
import { emptyAddress } from '@/lib/address/utils';

/**
 * Parse a flat GRP address string into structured fields.
 * Best-effort: fills what it can, leaves rest empty.
 */
export function parseGrpAddress(flat: string | null | undefined): StructuredAddress {
  const addr = emptyAddress();
  if (!flat || !flat.trim()) return addr;

  // Always Belarus for MNS data
  addr.country_code = 'BY';
  addr.country_name = 'Беларусь';

  // Normalize: remove extra spaces, normalize commas
  let s = flat.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ');

  // Extract postal code (6 digits at the start)
  const postalMatch = s.match(/^(\d{6})\s*,?\s*/);
  if (postalMatch) {
    addr.postal_code = postalMatch[1];
    s = s.slice(postalMatch[0].length).trim();
  }

  // Split into parts
  const parts = s.split(',').map(p => p.trim()).filter(Boolean);

  for (const part of parts) {
    const lower = part.toLowerCase();

    // Region (область)
    if (/обл\.?$/i.test(part) || /область$/i.test(part)) {
      addr.region = part;
      continue;
    }

    // District (район)
    if (/р-н\.?$/i.test(part) || /район$/i.test(part)) {
      addr.district = part;
      continue;
    }

    // City
    if (/^г\.\s*/i.test(part) || /^город\s+/i.test(part)) {
      addr.city = part.replace(/^(г\.\s*|город\s+)/i, '').trim();
      continue;
    }

    // Settlement (поселок, деревня, агрогородок)
    if (/^(п\.\s*|пос\.\s*|д\.\s*|дер\.\s*|аг\.\s*|агрогородок\s+)/i.test(part)) {
      addr.settlement = part;
      continue;
    }

    // Street
    if (/^(ул\.\s*|улица\s+|пр\.\s*|пр-т\.\s*|проспект\s+|пер\.\s*|переулок\s+|б-р\.\s*|бульвар\s+|наб\.\s*|набережная\s+|ш\.\s*|шоссе\s+|пл\.\s*|площадь\s+)/i.test(part)) {
      addr.street = part;
      continue;
    }

    // House
    if (/^(д\.\s*|дом\s+)/i.test(part) && !(/^(д\.\s*|дер\.)/i.test(part) && /[а-яё]{2,}/i.test(part))) {
      addr.house = part.replace(/^(д\.\s*|дом\s+)/i, '').trim();
      continue;
    }

    // Building (корпус)
    if (/^(корп?\.\s*|корпус\s+|к\.\s*|стр\.\s*|строение\s+)/i.test(part)) {
      addr.building = part.replace(/^(корп?\.\s*|корпус\s+|к\.\s*|стр\.\s*|строение\s+)/i, '').trim();
      continue;
    }

    // Apartment / office
    if (/^(оф\.\s*|офис\s+|кв\.\s*|квартира\s+|каб\.\s*|кабинет\s+|пом\.\s*|помещение\s+)/i.test(part)) {
      addr.apartment = part.replace(/^(оф\.\s*|офис\s+|кв\.\s*|квартира\s+|каб\.\s*|кабинет\s+|пом\.\s*|помещение\s+)/i, '').trim();
      continue;
    }

    // Fallback: if we don't have a city yet and it looks like a city name
    if (!addr.city && /^[А-ЯЁ][а-яё]+/.test(part) && !addr.street) {
      // Could be a city without prefix
      addr.city = part;
      continue;
    }

    // Fallback: if looks like a standalone house number (just digits, maybe with letter)
    if (!addr.house && /^\d+[а-яА-Яa-zA-Z]?$/.test(part)) {
      addr.house = part;
      continue;
    }
  }

  return addr;
}
