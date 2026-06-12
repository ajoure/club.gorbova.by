// PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve C
// Frontend mirror of canonical DTO returned by `admin-payment-documents-resolve`.
// READ-ONLY. No business rules. No provider allowlist. No refund logic.
// No scenario matching. No URL building. No deduplication.
//
// Single source of contract truth: backend
// supabase/functions/_shared/payments/documents/types.ts
//
// This file MUST stay structurally compatible; mismatch is caught by
// contract-fixture test in `paymentDocuments.test.ts`.

export type Provider = "stripe" | "bepaid";

export type UrlKind = "external_provider" | "signed_storage" | "unavailable";

export type ProviderDocumentType =
  | "receipt"
  | "hosted_invoice"
  | "invoice_pdf"
  | "credit_note_pdf"
  | "refund_receipt";

export type DocumentSource =
  | "local_meta"
  | "provider_api"
  | "local_meta+provider_api"
  | "parent_payment"
  | "internal_storage";

export type DocumentStatus = "available" | "unavailable" | "error";

export interface ProviderDocument {
  provider: Provider;
  type: ProviderDocumentType;
  external_id: string | null;
  status: DocumentStatus;
  source: DocumentSource;
  url: string | null;
  url_kind: UrlKind;
  can_open: boolean;
  can_download: boolean;
  can_copy: boolean;
  expires_at: string | null;
  warning?: MachineCode | null;
}

export interface InternalDocument {
  id: string;
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
  | "NO_DOCUMENT_SCENARIO"
  | "MISSING_REQUIRED_REQUISITES"
  | "DOCUMENT_ALREADY_GENERATED"
  | "GENERATION_IN_PROGRESS"
  | "GENERATION_FAILED"
  | "PAYMENT_NOT_LINKED_TO_ORDER"
  | "REFUND_USES_PARENT_DOCUMENTS"
  | "STRIPE_ACCOUNT_NOT_RESOLVED"
  | "STRIPE_ACCOUNT_CODE_CONFLICT"
  | "STRIPE_CONNECTION_AMBIGUOUS"
  | "STRIPE_MODE_NOT_RESOLVED"
  | "STRIPE_MODE_CONFLICT"
  | "STRIPE_MODE_MISMATCH";

export type UrlWarningCode =
  | "UNSAFE_DOCUMENT_URL"
  | "PROVIDER_DOCUMENT_ID_NOT_RESOLVED";

export type ResolverWarningCode =
  | UrlWarningCode
  | "REFUND_PARENT_NOT_RESOLVED"
  | "BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY"
  | "PROVIDER_DOCUMENT_RETRIEVE_FAILED"
  | "GENERATION_RESOLVER_NOT_READ_ONLY";

/** Superset of all known safe machine codes the frontend localizes. */
export type MachineCode =
  | GenerationCode
  | ResolverWarningCode
  // Stripe client resolution detail codes (surfaced via warning.detail).
  | "STRIPE_SECRET_UNAVAILABLE"
  | "INVALID_STRIPE_RESOURCE"
  | "INVALID_STRIPE_ID"
  | "STRIPE_HTTP_ERROR"
  | "NETWORK_ERROR"
  | "REQUEST_TIMEOUT";

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

// ── Runtime DTO guard ────────────────────────────────────────────────────────
// Edge Function response arrives as unknown — TypeScript types alone are NOT
// trusted. This guard does ONLY structural / type-shape checks.
// It MUST NOT encode any business rule (scenario, refund parent, provider
// allowlist, etc.) — those remain server-side.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function isNumberOrNull(v: unknown): v is number | null {
  return v === null || typeof v === "number";
}

function isBool(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isProvider(v: unknown): v is Provider {
  return v === "stripe" || v === "bepaid";
}

function isProviderDocument(v: unknown): v is ProviderDocument {
  if (!isObject(v)) return false;
  return (
    isProvider(v.provider) &&
    isString(v.type) &&
    isStringOrNull(v.external_id) &&
    isString(v.status) &&
    isString(v.source) &&
    isStringOrNull(v.url) &&
    isString(v.url_kind) &&
    isBool(v.can_open) &&
    isBool(v.can_download) &&
    isBool(v.can_copy) &&
    isStringOrNull(v.expires_at)
  );
}

function isInternalDocument(v: unknown): v is InternalDocument {
  if (!isObject(v)) return false;
  return (
    isString(v.id) &&
    isString(v.order_id) &&
    (v.document_type === null || isString(v.document_type)) &&
    (v.status === null || isString(v.status)) &&
    (v.number === null || isString(v.number)) &&
    isString(v.created_at) &&
    isStringOrNull(v.url) &&
    isString(v.url_kind) &&
    isBool(v.can_open) &&
    isBool(v.can_download) &&
    isBool(v.can_copy) &&
    isStringOrNull(v.expires_at)
  );
}

function isResolverWarning(v: unknown): v is ResolverWarning {
  if (!isObject(v)) return false;
  if (!isString(v.code)) return false;
  if (v.retryable !== undefined && !isBool(v.retryable)) return false;
  if (v.detail !== undefined && v.detail !== null && !isString(v.detail)) {
    return false;
  }
  return true;
}

function isGenerationInfo(v: unknown): v is GenerationInfo {
  if (!isObject(v)) return false;
  return (
    isBool(v.scenario_found) &&
    isBool(v.can_generate) &&
    (v.blocked_reason === null || isString(v.blocked_reason))
  );
}

function isPaymentSummary(v: unknown): v is PaymentSummary {
  if (!isObject(v)) return false;
  return (
    isString(v.id) &&
    isProvider(v.provider) &&
    isString(v.status) &&
    isNumberOrNull(v.amount) &&
    isStringOrNull(v.currency) &&
    isStringOrNull(v.order_id) &&
    isBool(v.is_refund)
  );
}

export function isResolverResponse(v: unknown): v is ResolverResponse {
  if (!isObject(v)) return false;
  if (!isPaymentSummary(v.payment)) return false;
  if (!Array.isArray(v.provider_documents)) return false;
  if (!v.provider_documents.every(isProviderDocument)) return false;
  if (!Array.isArray(v.internal_documents)) return false;
  if (!v.internal_documents.every(isInternalDocument)) return false;
  if (!isGenerationInfo(v.generation)) return false;
  if (v.diagnostics !== null && !isObject(v.diagnostics)) return false;
  if (!Array.isArray(v.warnings)) return false;
  if (!v.warnings.every(isResolverWarning)) return false;
  return true;
}
