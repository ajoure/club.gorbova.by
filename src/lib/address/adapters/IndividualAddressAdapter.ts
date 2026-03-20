/**
 * IndividualAddressAdapter — maps between 7 legacy ind_address_* fields,
 * StructuredAddress, and ind_address_structured JSONB.
 *
 * Read: structured JSONB → fallback legacy fields
 * Write: StructuredAddress → JSONB + recompute legacy fields
 */

import type { StructuredAddress, CanonicalAddressPayload } from '../types';
import { emptyAddress, formatFullAddress } from '../utils';
import { AddressNormalizationService } from '../AddressNormalizationService';

interface IndividualLegacyFields {
  ind_address_index?: string | null;
  ind_address_region?: string | null;
  ind_address_district?: string | null;
  ind_address_city?: string | null;
  ind_address_street?: string | null;
  ind_address_house?: string | null;
  ind_address_apartment?: string | null;
  ind_address_structured?: CanonicalAddressPayload | null;
}

export class IndividualAddressAdapter {
  /**
   * Read: JSONB → StructuredAddress, fallback to legacy 7 fields.
   */
  static toStructuredAddress(data: IndividualLegacyFields): StructuredAddress {
    if (data.ind_address_structured && !AddressNormalizationService.isPayloadEmpty(data.ind_address_structured as CanonicalAddressPayload)) {
      return AddressNormalizationService.payloadToStructuredAddress(data.ind_address_structured as CanonicalAddressPayload);
    }

    return {
      ...emptyAddress(),
      postal_code: data.ind_address_index || '',
      region: data.ind_address_region || '',
      district: data.ind_address_district || '',
      city: data.ind_address_city || '',
      street: data.ind_address_street || '',
      house: data.ind_address_house || '',
      apartment: data.ind_address_apartment || '',
    };
  }

  /**
   * Write: StructuredAddress → legacy fields + JSONB payload.
   */
  static toLegacyFields(addr: StructuredAddress, source: 'manual' | 'google' | 'grp' = 'manual'): IndividualLegacyFields {
    return {
      ind_address_index: addr.postal_code || null,
      ind_address_region: addr.region || null,
      ind_address_district: addr.district || null,
      ind_address_city: addr.city || null,
      ind_address_street: addr.street || null,
      ind_address_house: addr.house || null,
      ind_address_apartment: addr.apartment || null,
      ind_address_structured: AddressNormalizationService.normalize(addr, source) as unknown as CanonicalAddressPayload,
    };
  }
}
