/**
 * PATCH-GRANT-ACCESS-ELIGIBILITY-V1 / ELIG-C1-SHADOW
 *
 * Pure helper. NO Supabase / IO / DML. Given an order, its linked
 * payments_v2 rows and (optional) existing entitlement, compute a
 * shadow eligibility verdict for grant-access-for-order.
 *
 * Contract:
 *   would_allow = true | false | null
 *     - true  → strong allow-candidate (still shadow only until C2 lands
 *               financial-truth and enforcement is authorized)
 *     - false → strong deny-candidate
 *     - null  → manual review required (ambiguous / unverified)
 *   reason      → machine-readable label; see EligibilityReason
 *   evidence    → non-sensitive attributes used to reach the verdict
 *
 * NEVER records tokens. NEVER decides identity. Caller/branch is passed
 * in from the already-resolved caller_auth.ts result.
 *
 * Canonical payment providers (all model, per ELIG-C1 correction):
 *   bepaid | stripe | rr | bank
 *
 * Excluded from evidence (not treated as canonical proof-of-payment):
 *   - deleted_at IS NOT NULL
 *   - test / sandbox payments (provider ∈ admin/admin_test/test/sandbox
 *     OR meta.test === true OR meta.sandbox === true
 *     OR meta.livemode === false)
 *   - standalone manual payment without order_id (caller does not
 *     supply such rows since we filter by order_id upstream)
 */

export type CallerType = "service_role" | "admin" | "ordinary_user";
export type Branch =
  | "standard"
  | "adminManualAccessEdit"
  | "3ds_finalize"
  | "subscription_renewal"
  | "legacy_body_alias";

export const CANONICAL_PROVIDERS = ["bepaid", "stripe", "rr", "bank"] as const;
export type CanonicalProvider = typeof CANONICAL_PROVIDERS[number];

export type EligibilityReason =
  // deny
  | "would_deny_deal_only"
  | "would_deny_test_payment"
  | "would_deny_refunded"
  | "would_deny_unpaid"
  | "would_deny_failed"
  // allow candidates
  | "allow_admin_edit_existing_candidate"
  | "allow_admin_gift"
  | "allow_admin_manual_grant_candidate"
  | "allow_admin_extend_existing_candidate"
  | "allow_paid_canonical_candidate"
  | "allow_3ds_finalize_candidate"
  | "allow_subscription_renewal_candidate"
  // manual review
  | "manual_review_admin_edit_without_access"
  | "manual_review_financial_truth_pending_c2"
  | "manual_review_refund_ambiguous"
  | "manual_review_status_payment_conflict"
  | "manual_review_currency_conflict"
  | "manual_review_insufficient_amount"
  | "manual_review_multiple_succeeded_payments"
  | "manual_review_trial_contract_unverified"
  | "manual_review_legacy_backfill"
  | "manual_review_legacy_deal_only_semantics"
  | "manual_review_ambiguous";

export interface EligibilityEvidence {
  branch: Branch;
  caller_type: CallerType;
  order_status: string | null;
  order_final_price: number | null;
  order_currency: string | null;
  is_trial: boolean;
  meta_source: string | null;
  meta_deal_only: boolean;
  is_no_card_zero: boolean;
  gross_succeeded: number | null;
  net_paid: number | null;
  currency_conflict: boolean;
  amount_insufficient: boolean;
  canonical_payment_ids: string[];
  canonical_payment_count: number;
  provider_set: string[];
  refund_ambiguity: boolean;
  refund_row_present: boolean;
  parent_refunded_amount_present: boolean;
  test_or_sandbox_only: boolean;
  existing_entitlement: boolean;
  exception_type: string | null;
}

export interface EligibilityInput {
  branch: Branch;
  callerType: CallerType;
  order: any;
  payments: any[];
  existingEntitlement?: any | null;
  claimedSource?: string | null;
  claimedContext?: string | null;
}

export interface EligibilityResult {
  would_allow: boolean | null;
  reason: EligibilityReason;
  evidence: EligibilityEvidence;
}

const EPSILON = 0.01;

function toNumber(x: any): number {
  const n = typeof x === "number" ? x : parseFloat(x);
  return Number.isFinite(n) ? n : 0;
}

function isRefundRow(p: any): boolean {
  const tt = String(p?.transaction_type || "").toLowerCase();
  if (tt.includes("refund") || tt.includes("возврат")) return true;
  if (p?.meta?.type === "refund") return true;
  if (toNumber(p?.amount) < 0) return true;
  return false;
}

function isTestPayment(p: any): boolean {
  const prov = String(p?.provider || "").toLowerCase();
  if (prov === "admin" || prov === "admin_test" || prov === "test" || prov === "sandbox") return true;
  if (prov.endsWith("_test")) return true;
  const meta = p?.meta || {};
  if (meta.test === true || meta.sandbox === true) return true;
  if (meta.livemode === false) return true;
  const env = String(meta.env || "").toLowerCase();
  if (env === "test" || env === "sandbox") return true;
  return false;
}

function isCanonicalProvider(p: any): boolean {
  const prov = String(p?.provider || "").toLowerCase();
  return (CANONICAL_PROVIDERS as readonly string[]).includes(prov);
}

function isSucceededStatus(s: any): boolean {
  const v = String(s || "").toLowerCase();
  return v === "paid" || v === "succeeded";
}

export function evaluateGrantEligibility(input: EligibilityInput): EligibilityResult {
  const { branch, callerType, order } = input;
  const payments = Array.isArray(input.payments) ? input.payments : [];
  const existingEntitlement = input.existingEntitlement || null;

  const meta = (order?.meta || {}) as Record<string, any>;
  const metaSource: string | null =
    typeof meta.source === "string" ? meta.source : null;
  const metaDealOnly = meta.deal_only === true;
  const orderStatus: string | null =
    typeof order?.status === "string" ? order.status : null;
  const finalPrice = order?.final_price != null ? toNumber(order.final_price) : null;
  const paidAmount = order?.paid_amount != null ? toNumber(order.paid_amount) : 0;
  const currency = order?.currency || null;
  const isTrial = order?.is_trial === true;

  // Partition payments.
  const alive = payments.filter((p) => !p?.deleted_at);
  const refundRows = alive.filter(isRefundRow);
  const nonRefund = alive.filter((p) => !isRefundRow(p));

  const canonicalNonRefund = nonRefund.filter(isCanonicalProvider);
  const canonicalSucceeded = canonicalNonRefund.filter(
    (p) => isSucceededStatus(p.status) && !isTestPayment(p),
  );
  const canonicalSucceededTestOnly = canonicalNonRefund.filter(
    (p) => isSucceededStatus(p.status) && isTestPayment(p),
  );

  const grossSucceeded = canonicalSucceeded.reduce(
    (acc, p) => acc + toNumber(p.amount),
    0,
  );
  const parentRefundedTotal = canonicalNonRefund.reduce(
    (acc, p) => acc + toNumber(p.refunded_amount),
    0,
  );
  const legacyRefundTotal = refundRows.reduce(
    (acc, p) => acc + Math.abs(toNumber(p.amount)),
    0,
  );
  const refundRowPresent = refundRows.length > 0;
  const parentRefundedPresent = parentRefundedTotal > EPSILON;
  const refundAmbiguity =
    (refundRowPresent && parentRefundedPresent) ||
    (refundRowPresent && canonicalSucceeded.length > 1) ||
    (parentRefundedPresent && canonicalSucceeded.length > 1);

  const currencySet = new Set(
    canonicalSucceeded
      .map((p) => (p.currency ? String(p.currency).toUpperCase() : null))
      .filter((c): c is string => !!c),
  );
  const orderCurrencyU = currency ? String(currency).toUpperCase() : null;
  const currencyConflict =
    orderCurrencyU != null &&
    currencySet.size > 0 &&
    (currencySet.size > 1 || !currencySet.has(orderCurrencyU));

  const amountInsufficient =
    finalPrice != null &&
    finalPrice > 0 &&
    canonicalSucceeded.length > 0 &&
    grossSucceeded + EPSILON < finalPrice;

  const canonicalPaymentIds = canonicalSucceeded
    .map((p) => String(p.id || p.provider_payment_id || ""))
    .filter(Boolean);
  const providerSet = Array.from(
    new Set(canonicalSucceeded.map((p) => String(p.provider || "").toLowerCase())),
  );
  const testOrSandboxOnly =
    canonicalSucceeded.length === 0 && canonicalSucceededTestOnly.length > 0;

  const isNoCardZero =
    finalPrice === 0 &&
    paidAmount === 0 &&
    canonicalSucceeded.length === 0;

  const baseEvidence: EligibilityEvidence = {
    branch,
    caller_type: callerType,
    order_status: orderStatus,
    order_final_price: finalPrice,
    order_currency: currency,
    is_trial: isTrial,
    meta_source: metaSource,
    meta_deal_only: metaDealOnly,
    is_no_card_zero: isNoCardZero,
    gross_succeeded: canonicalSucceeded.length > 0 ? grossSucceeded : null,
    net_paid: canonicalSucceeded.length > 0
      ? grossSucceeded - parentRefundedTotal - legacyRefundTotal
      : null,
    currency_conflict: currencyConflict,
    amount_insufficient: amountInsufficient,
    canonical_payment_ids: canonicalPaymentIds,
    canonical_payment_count: canonicalSucceeded.length,
    provider_set: providerSet,
    refund_ambiguity: refundAmbiguity,
    refund_row_present: refundRowPresent,
    parent_refunded_amount_present: parentRefundedPresent,
    test_or_sandbox_only: testOrSandboxOnly,
    existing_entitlement: !!existingEntitlement,
    exception_type: null,
  };

  const R = (reason: EligibilityReason, would_allow: boolean | null, exception_type: string | null = null): EligibilityResult => ({
    would_allow,
    reason,
    evidence: { ...baseEvidence, exception_type },
  });

  // ─────────────────────────────────────────────────────────
  // Priority per spec.
  // ─────────────────────────────────────────────────────────

  // 3DS / renewal candidate branches. Log the branch-specific evidence
  // and DO NOT deny; C2 will land the strict contract. Still applies
  // deny for exact admin_deal_only / refunded.
  if (branch === "3ds_finalize") {
    if (orderStatus === "refunded") return R("would_deny_refunded", false);
    return R("allow_3ds_finalize_candidate", true, "three_ds_finalize");
  }
  if (branch === "subscription_renewal") {
    if (orderStatus === "refunded") return R("would_deny_refunded", false);
    return R("allow_subscription_renewal_candidate", true, "subscription_renewal");
  }

  // 1) adminManualAccessEdit: existing access resolves eligibility.
  if (branch === "adminManualAccessEdit") {
    if (existingEntitlement) {
      return R("allow_admin_edit_existing_candidate", true, "admin_edit");
    }
    return R("manual_review_admin_edit_without_access", null, "admin_edit");
  }

  // 2) exact admin_deal_only
  if (metaSource === "admin_deal_only") {
    return R("would_deny_deal_only", false, "admin_deal_only");
  }

  // 3) test/sandbox-only evidence (no non-test succeeded canonical row).
  if (testOrSandboxOnly) {
    return R("would_deny_test_payment", false, "test_payment_only");
  }

  // 4) refunded order (full).
  if (orderStatus === "refunded") {
    return R("would_deny_refunded", false);
  }

  // 5) refund / multi-payment ambiguity — defer to C2.
  if (refundAmbiguity) {
    return R("manual_review_financial_truth_pending_c2", null, "refund_or_multi_payment");
  }
  if (refundRowPresent || parentRefundedPresent) {
    return R("manual_review_refund_ambiguous", null, "refund_evidence_partial");
  }

  // 6) admin explicit zero-price grant (strict contract).
  if (
    callerType === "admin" &&
    branch === "standard" &&
    orderStatus === "paid" &&
    finalPrice === 0 &&
    paidAmount === 0 &&
    metaSource === "admin_grant" &&
    !metaDealOnly &&
    canonicalSucceeded.length === 0
  ) {
    return R("allow_admin_gift", true, "admin_grant_zero_price");
  }
  // Admin bulk/manual grant candidates (not strict admin_grant contract).
  if (
    callerType === "admin" &&
    branch === "standard" &&
    (metaSource === "admin_manual_grant" || metaSource === "admin_bulk_grant")
  ) {
    return R("allow_admin_manual_grant_candidate", true, "admin_manual_grant");
  }
  if (
    callerType === "admin" &&
    branch === "standard" &&
    existingEntitlement &&
    (metaSource === "admin_extend" || metaSource === "admin_manual_extend")
  ) {
    return R("allow_admin_extend_existing_candidate", true, "admin_extend");
  }

  // 7) canonical simple paid case.
  if (orderStatus === "paid" && canonicalSucceeded.length === 1 && !refundAmbiguity) {
    if (currencyConflict) return R("manual_review_currency_conflict", null, "currency_conflict");
    if (amountInsufficient) return R("manual_review_insufficient_amount", null, "amount_insufficient");
    return R("allow_paid_canonical_candidate", true, "simple_paid");
  }
  if (canonicalSucceeded.length > 1) {
    return R("manual_review_multiple_succeeded_payments", null, "multi_payment");
  }

  // 8) pending/draft without payment.
  const unpaidStatuses = new Set(["pending", "draft", "awaiting_payment", "created", "new"]);
  if (unpaidStatuses.has(String(orderStatus || "").toLowerCase()) && canonicalSucceeded.length === 0) {
    return R("would_deny_unpaid", false, "unpaid");
  }

  // 9) failed without payment.
  const failedStatuses = new Set(["failed", "cancelled", "canceled", "expired"]);
  if (failedStatuses.has(String(orderStatus || "").toLowerCase()) && canonicalSucceeded.length === 0) {
    return R("would_deny_failed", false, "failed");
  }

  // 10) failed/pending/partial WITH succeeded payment → status/payment conflict.
  if (
    canonicalSucceeded.length > 0 &&
    orderStatus !== "paid" &&
    orderStatus !== "refunded"
  ) {
    return R("manual_review_status_payment_conflict", null, "status_payment_conflict");
  }

  // 11) trial contract unverified (kept before legacy so trial doesn't fall through).
  if (isTrial) {
    return R("manual_review_trial_contract_unverified", null, "trial");
  }

  // Legacy deal_only flag (not the exact admin_deal_only source).
  if (metaDealOnly) {
    return R("manual_review_legacy_deal_only_semantics", null, "legacy_deal_only");
  }

  // 12) legacy backfill semantics.
  const legacySources = new Set(["legacy_backfill", "backfill", "manual_backfill"]);
  if (
    (metaSource && legacySources.has(metaSource)) ||
    meta.legacy_backfill === true
  ) {
    return R("manual_review_legacy_backfill", null, "legacy_backfill");
  }

  // 13) otherwise
  return R("manual_review_ambiguous", null, null);
}
