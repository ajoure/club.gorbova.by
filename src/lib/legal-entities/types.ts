/**
 * Unified contract for legal entity lookup results (MNS GRP registry).
 * Single source of truth for GRP lookup data model.
 */

export interface LegalEntityLookupData {
  unp: string;
  full_name: string;
  short_name: string | null;
  legal_address: string | null;
  registration_date: string | null;
  tax_office_code: string | null;
  tax_office_name: string | null;
  status_code: string | null;
  status_name: string | null;
  liquidation_date: string | null;
  liquidation_reason?: string | null;
}

export interface LegalEntityLookupResult {
  found: boolean;
  status: 'found' | 'not_found' | 'invalid' | 'unavailable';
  source: 'direct' | 'proxy';
  message?: string;
  data?: LegalEntityLookupData;
  raw?: unknown;
}

/**
 * Unified meta.grp structure for storing GRP lookup snapshots.
 * Never replace entire meta — only merge the grp branch.
 */
export interface GrpMetaBranch {
  source: 'direct' | 'proxy';
  last_lookup_at: string;
  unp?: string;
  full_name?: string;
  short_name?: string | null;
  address?: string | null;
  registration_date?: string | null;
  tax_office_code?: string | null;
  tax_office_name?: string | null;
  status_code?: string | null;
  status_name?: string | null;
  liquidation_date?: string | null;
  liquidation_reason?: string | null;
  raw?: unknown;
}

/**
 * Normalized preview model for UI display of GRP lookup results.
 */
export interface LegalEntityPreviewData {
  full_name: string;
  short_name?: string | null;
  unp?: string;
  legal_address?: string | null;
  registration_date?: string | null;
  tax_office_code?: string | null;
  tax_office_name?: string | null;
  status_code?: string | null;
  status_name?: string | null;
  liquidation_date?: string | null;
  liquidation_reason?: string | null;
  last_lookup_at?: string | null;
}
