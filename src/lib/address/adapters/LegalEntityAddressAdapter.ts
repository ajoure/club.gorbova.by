/**
 * LegalEntityAddressAdapter — maps between leg_address string,
 * leg_address_structured JSONB, and StructuredAddress.
 */

import type { StructuredAddress, CanonicalAddressPayload } from '../types';
import { emptyAddress, formatFullAddress } from '../utils';
import { AddressNormalizationService } from '../AddressNormalizationService';

interface LegalEntityLegacyFields {
  leg_address?: string | null;
  leg_address_structured?: CanonicalAddressPayload | null;
}

export class LegalEntityAddressAdapter {
  static toStructuredAddress(data: LegalEntityLegacyFields): StructuredAddress {
    if (data.leg_address_structured && !AddressNormalizationService.isPayloadEmpty(data.leg_address_structured as CanonicalAddressPayload)) {
      return AddressNormalizationService.payloadToStructuredAddress(data.leg_address_structured as CanonicalAddressPayload);
    }
    // Can't parse a single string back to structured — return empty with raw hint
    return emptyAddress();
  }

  static toLegacyFields(addr: StructuredAddress, source: 'manual' | 'google' | 'grp' = 'manual'): LegalEntityLegacyFields {
    return {
      leg_address: formatFullAddress(addr) || null,
      leg_address_structured: AddressNormalizationService.normalize(addr, source) as unknown as CanonicalAddressPayload,
    };
  }
}
