// PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B — bePaid adapter (strict read-only).
//
// Sources:
//   1) payments_v2.receipt_url (DB column)
//   2) meta.provider_response.transaction.receipt_url
//
// Provider refresh is NOT performed here. bepaid-get-payment-docs has write
// side-effects and MUST NOT be invoked from this resolver. If no local receipt,
// refresh=true returns BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY warning;
// drawer keeps working.

import type { ProviderDocument, ResolverWarning } from './types.ts';
import { classifyProviderUrl } from './url-security.ts';

export interface BePaidLocal {
  receipt_url?: string | null;
  provider_payment_id?: string | null;
  transaction_uid?: string | null;
  transaction_receipt_url?: string | null;
}

export function resolveBePaidDocuments(
  local: BePaidLocal,
  refresh: boolean,
): { documents: ProviderDocument[]; warnings: ResolverWarning[] } {
  const docs: ProviderDocument[] = [];
  const warnings: ResolverWarning[] = [];

  const externalId = local.transaction_uid ?? local.provider_payment_id ?? null;
  const url = local.receipt_url ?? local.transaction_receipt_url ?? null;

  if (url) {
    const verdict = classifyProviderUrl(url);
    if (!externalId) {
      docs.push({
        provider: 'bepaid', type: 'receipt', external_id: null,
        status: 'unavailable', source: 'local_meta',
        url: null, url_kind: 'unavailable',
        can_open: false, can_download: false, can_copy: false, expires_at: null,
        warning: 'PROVIDER_DOCUMENT_ID_NOT_RESOLVED',
      });
    } else if (!verdict.safe) {
      docs.push({
        provider: 'bepaid', type: 'receipt', external_id: externalId,
        status: 'unavailable', source: 'local_meta',
        url: null, url_kind: 'unavailable',
        can_open: false, can_download: false, can_copy: false, expires_at: null,
        warning: 'UNSAFE_DOCUMENT_URL',
      });
    } else {
      docs.push({
        provider: 'bepaid', type: 'receipt', external_id: externalId,
        status: 'available', source: 'local_meta',
        url, url_kind: 'external_provider',
        can_open: true, can_download: false, can_copy: true, expires_at: null,
      });
    }
  }

  if (refresh && docs.length === 0) {
    warnings.push({ code: 'BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY', retryable: false });
  }

  return { documents: docs, warnings };
}
