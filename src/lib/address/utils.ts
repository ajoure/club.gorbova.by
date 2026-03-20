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
// Build autocomplete query from filled fields (context-aware)
// ---------------------------------------------------------------------------

export function buildAutocompleteQuery(
  addr: StructuredAddress,
  activeField: keyof StructuredAddress,
  activeValue: string
): string {
  const contextParts: string[] = [];
  const fieldOrder: (keyof StructuredAddress)[] = [
    'street', 'house', 'settlement', 'city', 'district', 'region', 'postal_code', 'country_name',
  ];

  for (const field of fieldOrder) {
    const val = field === activeField ? activeValue : (addr[field] as string ?? '');
    if (val.trim()) {
      contextParts.push(val.trim());
    }
  }

  return contextParts.join(', ');
}
