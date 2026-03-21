/**
 * Address utilities — global standard for the entire platform.
 *
 * - emptyAddress(): empty StructuredAddress, no country default
 * - formatFullAddress(): international formatter, country-aware, skips empty parts
 * - parseGoogleAddressComponents(): universal parser with fallback chains
 * - isAddressEmpty(): check if all structured fields are empty
 * - buildAutocompleteQuery(): assemble context from filled fields for Google query
 */

import type { StructuredAddress } from './types';

// ---------------------------------------------------------------------------
// Empty address factory
// ---------------------------------------------------------------------------

export function emptyAddress(): StructuredAddress {
  return {
    country_code: '',
    country_name: '',
    region: '',
    district: '',
    city: '',
    settlement: '',
    street: '',
    house: '',
    building: '',
    apartment: '',
    postal_code: '',
    address_line_2: '',
    google_place_id: null,
    lat: null,
    lng: null,
  };
}

// ---------------------------------------------------------------------------
// International full_address formatter
// ---------------------------------------------------------------------------

export function formatFullAddress(addr: Partial<StructuredAddress>): string {
  const parts: string[] = [];

  const street = (addr.street ?? '').trim();
  const house = (addr.house ?? '').trim();
  if (street) {
    parts.push(house ? `${street} ${house}` : street);
  } else if (house) {
    parts.push(house);
  }

  const push = (val: string | undefined | null) => {
    const v = (val ?? '').trim();
    if (v) parts.push(v);
  };

  push(addr.building);
  push(addr.apartment);
  push(addr.address_line_2);
  push(addr.settlement);
  push(addr.city);
  push(addr.district);
  push(addr.region);
  push(addr.postal_code);
  push(addr.country_name);

  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Check if address is empty
// ---------------------------------------------------------------------------

export function isAddressEmpty(addr: StructuredAddress): boolean {
  return (
    !addr.country_code &&
    !addr.country_name &&
    !addr.region &&
    !addr.district &&
    !addr.city &&
    !addr.settlement &&
    !addr.street &&
    !addr.house &&
    !addr.building &&
    !addr.apartment &&
    !addr.postal_code &&
    !addr.address_line_2
  );
}

// ---------------------------------------------------------------------------
// Build autocomplete query from filled fields (hierarchy-aware)
// ---------------------------------------------------------------------------

/**
 * Build a safe autocomplete query from the active field value + minimal parent context.
 *
 * Rules:
 * - For `street`: activeValue only (+ country_name if set). No stale city/region/house.
 *   User is starting a new address; old context would pollute results.
 * - For `city`: activeValue + country_name only.
 * - For `settlement`: activeValue + city + country_name.
 * - For `region`/`district`: activeValue + country_name.
 * - For `house`: activeValue + street + city + country_name (refining existing address).
 * - For `country_name`: activeValue only.
 * - Never include postal_code, building, apartment in query.
 */
export function buildAutocompleteQuery(
  addr: StructuredAddress,
  activeField: keyof StructuredAddress,
  activeValue: string
): string {
  const parts: string[] = [];
  const av = activeValue.trim();
  if (av) parts.push(av);

  const push = (field: keyof StructuredAddress) => {
    const v = (addr[field] as string ?? '').trim();
    if (v) parts.push(v);
  };

  switch (activeField) {
    case 'street':
      // Fresh search — only country as context to avoid stale city/region
      push('country_name');
      break;
    case 'city':
      push('country_name');
      break;
    case 'settlement':
      push('city');
      push('country_name');
      break;
    case 'house':
      push('street');
      push('city');
      push('country_name');
      break;
    case 'region':
    case 'district':
      push('country_name');
      break;
    default:
      // country_name, postal_code, etc. — just activeValue
      break;
  }

  return parts.join(', ');
}
