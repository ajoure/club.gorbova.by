/**
 * ExecutorAddressAdapter — maps between legal_address string,
 * legal_address_structured JSONB, and StructuredAddress.
 */

import type { StructuredAddress, CanonicalAddressPayload } from '../types';
import { emptyAddress, formatFullAddress } from '../utils';
import { AddressNormalizationService } from '../AddressNormalizationService';

interface ExecutorLegacyFields {
  legal_address?: string | null;
  legal_address_structured?: CanonicalAddressPayload | null;
}

export class ExecutorAddressAdapter {
  static toStructuredAddress(data: ExecutorLegacyFields): StructuredAddress {
    if (data.legal_address_structured && !AddressNormalizationService.isPayloadEmpty(data.legal_address_structured as CanonicalAddressPayload)) {
      return AddressNormalizationService.payloadToStructuredAddress(data.legal_address_structured as CanonicalAddressPayload);
    }
    return emptyAddress();
  }

  static toLegacyFields(addr: StructuredAddress, source: 'manual' | 'google' | 'grp' = 'manual') {
    const payload = AddressNormalizationService.normalize(addr, source);
    return {
      legal_address: formatFullAddress(addr) || null,
      legal_address_structured: JSON.parse(JSON.stringify(payload)),
    };
  }
}
