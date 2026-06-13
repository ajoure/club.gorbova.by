// PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B
// Canonical types & machine codes for admin-payment-documents-resolve.
// Read-only. No DB writes. No generation. PCI-safe whitelist.

export type Provider = 'stripe' | 'bepaid';

export type UrlKind = 'external_provider' | 'signed_storage' | 'unavailable';

export type DocumentSource =
  | 'local_meta'
  | 'provider_api'
  | 'local_meta+provider_api'
  | 'parent_payment'
  | 'internal_storage';

export type DocumentStatus = 'available' | 'unavailable' | 'error';

/** Provider-side document. */
export interface ProviderDocument {
  provider: Provider;
  type:
    | 'receipt'              // stripe charge.receipt_url / bepaid receipt
    | 'hosted_invoice'       // stripe invoice.hosted_invoice_url
    | 'invoice_pdf'          // stripe invoice.invoice_pdf
    | 'credit_note_pdf'      // stripe credit_note.pdf
    | 'refund_receipt';      // stripe refund.receipt_url (if surfaced via parent)
  external_id: string | null; // canonical identity (ch_*, in_*, cn_*, transaction.uid, …)
  status: DocumentStatus;
  source: DocumentSource;
  url: string | null;
  url_kind: UrlKind;
  can_open: boolean;
  can_download: boolean;
  can_copy: boolean;
  expires_at: string | null;
  warning?: GenerationCode | UrlWarningCode | null;
}

/** Internal canonical document row from ai_generated_documents. */
export interface InternalDocument {
  id: string;                // UUID — identity
  order_id: string;
  document_type: string | null;
  status: string | null;
  number: string | null;
  created_at: string;
  url: string | null;
  url_kind: UrlKind;
  can_open: boolean;
  can_download: boolean;
  can_copy: boolean;
  expires_at: string | null;
}

export type GenerationCode =
  | 'NO_DOCUMENT_SCENARIO'
  | 'MISSING_REQUIRED_REQUISITES'
  | 'DOCUMENT_ALREADY_GENERATED'
  | 'GENERATION_IN_PROGRESS'
  | 'GENERATION_FAILED'
  | 'PAYMENT_NOT_LINKED_TO_ORDER'
  | 'REFUND_USES_PARENT_DOCUMENTS'
  | 'STRIPE_ACCOUNT_NOT_RESOLVED'
  | 'TEST_PAYMENT_DOCUMENT_BLOCKED';

export type UrlWarningCode =
  | 'UNSAFE_DOCUMENT_URL'
  | 'PROVIDER_DOCUMENT_ID_NOT_RESOLVED';

export type ResolverWarningCode =
  | UrlWarningCode
  | 'REFUND_PARENT_NOT_RESOLVED'
  | 'BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY'
  | 'PROVIDER_DOCUMENT_RETRIEVE_FAILED'
  | 'GENERATION_RESOLVER_NOT_READ_ONLY';

export interface ResolverWarning {
  code: ResolverWarningCode;
  retryable?: boolean;
  detail?: string | null;
}

export interface GenerationInfo {
  scenario_found: boolean;
  can_generate: boolean;
  blocked_reason: GenerationCode | null;
}

export interface PaymentSummary {
  id: string;
  provider: Provider;
  status: string;
  amount: number | null;
  currency: string | null;
  order_id: string | null;
  is_refund: boolean;
}

export interface ResolverResponse {
  payment: PaymentSummary;
  provider_documents: ProviderDocument[];
  internal_documents: InternalDocument[];
  generation: GenerationInfo;
  diagnostics: Record<string, unknown> | null;
  warnings: ResolverWarning[];
}

/** PCI / PII forbidden keys — must never appear in response or audit meta. */
export const PCI_FORBIDDEN_KEYS = [
  'card', 'card_number', 'number', 'cvc', 'cvv', 'exp_month', 'exp_year',
  'expiry', 'expiration', 'payment_method_data', 'pan',
  'card_holder', 'billing_details', 'customer',
] as const;

// ── Approve B.1 — Stripe client resolution (factory result) ─────────────────
// Safe machine codes surfaced via warning.detail; warning.code stays
// PROVIDER_DOCUMENT_RETRIEVE_FAILED so existing clients keep working.
export type StripeClientResolutionError =
  | 'STRIPE_ACCOUNT_NOT_RESOLVED'
  | 'STRIPE_ACCOUNT_CODE_CONFLICT'
  | 'STRIPE_CONNECTION_AMBIGUOUS'
  | 'STRIPE_MODE_NOT_RESOLVED'
  | 'STRIPE_MODE_CONFLICT'
  | 'STRIPE_MODE_MISMATCH'
  | 'STRIPE_SECRET_UNAVAILABLE'
  | 'INVALID_STRIPE_RESOURCE'
  | 'INVALID_STRIPE_ID'
  | 'STRIPE_HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'REQUEST_TIMEOUT';
