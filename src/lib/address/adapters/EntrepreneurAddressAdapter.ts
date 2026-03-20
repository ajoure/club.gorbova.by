/**
 * EntrepreneurAddressAdapter — maps between ent_address string,
 * ent_address_structured JSONB, and StructuredAddress.
 */

import type { StructuredAddress, CanonicalAddressPayload } from '../types';
import { emptyAddress, formatFullAddress } from '../utils';
import { AddressNormalizationService } from '../AddressNormalizationService';

interface EntrepreneurLegacyFields {
  ent_address?: string | null;
  ent_address_structured?: CanonicalAddressPayload | null;
}

export class EntrepreneurAddressAdapter {
  static toStructuredAddress(data: EntrepreneurLegacyFields): StructuredAddress {
    if (data.ent_address_structured && !AddressNormalizationService.isPayloadEmpty(data.ent_address_structured as CanonicalAddressPayload)) {
      return AddressNormalizationService.payloadToStructuredAddress(data.ent_address_structured as CanonicalAddressPayload);
    }
    return emptyAddress();
  }

  static toLegacyFields(addr: StructuredAddress, source: 'manual' | 'google' | 'grp' = 'manual') {
    const payload = AddressNormalizationService.normalize(addr, source);
    return {
      ent_address: formatFullAddress(addr) || null,
      ent_address_structured: JSON.parse(JSON.stringify(payload)),
    };
  }
}
