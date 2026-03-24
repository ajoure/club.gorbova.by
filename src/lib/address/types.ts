/**
 * Unified Structured Address model — canonical standard for the entire platform.
 *
 * Source of truth: structured fields stored as JSONB (CanonicalAddressPayload).
 * full_address / formatted_address is always derived/computed.
 * Legacy string fields (ent_address, leg_address, etc.) are compatibility layer only.
 */

export interface StructuredAddress {
  country_code: string;    // ISO 3166-1 alpha-2 upper-case (BY, PL, DE…)
  country_name: string;    // human-readable
  region: string;          // область / state / province
  district: string;        // район (административный район области)
  city: string;            // город / locality
  city_district: string;   // район города (Фрунзенский, Центральный…)
  settlement: string;      // населённый пункт / sublocality
  street: string;          // улица / route
  house: string;           // дом / street_number
  building: string;        // корпус
  apartment: string;       // квартира / офис / subpremise
  postal_code: string;     // индекс
  address_line_2: string;  // доп. строка (floor, entrance, etc.)
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
}

export type AddressSource = 'manual' | 'google' | 'grp';

/**
 * Canonical address payload stored as JSONB in shadow fields
 * (*_address_structured columns).
 */
export interface CanonicalAddressPayload {
  country: string | null;
  country_code: string | null;
  postal_code: string | null;
  region: string | null;
  district: string | null;
  city: string | null;
  city_district: string | null;
  settlement: string | null;
  street: string | null;
  house: string | null;
  building: string | null;
  apartment: string | null;
  raw_input: string | null;
  formatted_address: string | null;
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
  source: AddressSource;
  last_verified_at: string | null;
}

/** Fields that trigger autocomplete queries */
export const AUTOCOMPLETE_FIELDS: (keyof StructuredAddress)[] = [
  'street',
  'house',
  'city',
  'settlement',
  'region',
  'district',
  'postal_code',
  'country_name',
];

/** Fields that are manual-only (no autocomplete trigger) */
export const MANUAL_ONLY_FIELDS: (keyof StructuredAddress)[] = [
  'building',
  'apartment',
  'address_line_2',
];
