/**
 * AddressNormalizationService — validates, cleans, and assembles canonical address.
 *
 * Source of truth logic:
 * - If google_place_id exists and fields haven't been manually changed → source = 'google'
 * - If user edited any field after Google selection → source = 'manual'
 * - If filled from GRP lookup → source = 'grp'
 *
 * formatted_address is always recomputed from structured fields.
 */

import type { StructuredAddress, CanonicalAddressPayload, AddressSource } from './types';
import { formatFullAddress, isAddressEmpty, emptyAddress } from './utils';

export class AddressNormalizationService {
  /**
   * Normalize a partial StructuredAddress into a full CanonicalAddressPayload.
   */
  static normalize(
    raw: Partial<StructuredAddress>,
    source: AddressSource = 'manual',
    rawInput?: string | null
  ): CanonicalAddressPayload {
    const addr: StructuredAddress = { ...emptyAddress(), ...raw };
    const formatted = formatFullAddress(addr);

    return {
      country: addr.country_name || null,
      country_code: addr.country_code || null,
      postal_code: addr.postal_code || null,
      region: addr.region || null,
      district: addr.district || null,
      city: addr.city || null,
      city_district: addr.city_district || null,
      settlement: addr.settlement || null,
      street: addr.street || null,
      house: addr.house || null,
      building: addr.building || null,
      apartment: addr.apartment || null,
      raw_input: rawInput ?? null,
      formatted_address: formatted || null,
      google_place_id: addr.google_place_id || null,
      lat: addr.lat ?? null,
      lng: addr.lng ?? null,
      source,
      last_verified_at: source === 'google' ? new Date().toISOString() : null,
    };
  }

  /**
   * Determine the correct source based on current state.
   * If google_place_id is present and no manual edits detected → 'google'.
   * Otherwise → 'manual'.
   */
  static determineSource(
    addr: Partial<StructuredAddress>,
    previousSource?: AddressSource
  ): AddressSource {
    if (previousSource === 'grp') return 'grp';
    if (addr.google_place_id) return 'google';
    return 'manual';
  }

  /**
   * Mark address as manually edited (preserves google_place_id for reference,
   * but clears last_verified_at).
   */
  static markAsManuallyEdited(payload: CanonicalAddressPayload): CanonicalAddressPayload {
    return {
      ...payload,
      source: 'manual',
      last_verified_at: null,
    };
  }

  /**
   * Convert CanonicalAddressPayload back to StructuredAddress for form editing.
   */
  static payloadToStructuredAddress(payload: CanonicalAddressPayload): StructuredAddress {
    return {
      country_code: payload.country_code || '',
      country_name: payload.country || '',
      region: payload.region || '',
      district: payload.district || '',
      city: payload.city || '',
      city_district: payload.city_district || '',
      settlement: payload.settlement || '',
      street: payload.street || '',
      house: payload.house || '',
      building: payload.building || '',
      apartment: payload.apartment || '',
      postal_code: payload.postal_code || '',
      address_line_2: '',
      google_place_id: payload.google_place_id || null,
      lat: payload.lat ?? null,
      lng: payload.lng ?? null,
    };
  }

  /**
   * Check if a canonical payload is empty (all structured fields null/empty).
   */
  static isPayloadEmpty(payload: CanonicalAddressPayload | null | undefined): boolean {
    if (!payload) return true;
    return (
      !payload.country &&
      !payload.country_code &&
      !payload.region &&
      !payload.district &&
      !payload.city &&
      !payload.city_district &&
      !payload.settlement &&
      !payload.street &&
      !payload.house &&
      !payload.building &&
      !payload.apartment &&
      !payload.postal_code
    );
  }
}
