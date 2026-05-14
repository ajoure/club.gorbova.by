// §F SBS-MISMATCH NO-NEW-SUB GUARD — pure builders.
// Извлечено из index.ts (block ~767–892) для unit-тестируемости.
// Поведение 1:1 с inline-блоком; никаких side-effects, только сборка
// payload/audit/response. Используется внутри grant-access-for-order.

export type SkipDecision =
  | "skip_no_new_sub"        // recurring rebill, tariffMatch=true, sbsMatch=false → §F early return
  | "normal_extend"          // tariffMatch=true && sbsMatch=true
  | "create_new_tariff_mismatch" // !tariffMatch (legacy create-new — НЕ §F scope)
  | "create_new_primary";    // нет active candidate → первичный flow

export interface DecideInput {
  hasActiveCandidate: boolean;
  tariffMatch: boolean;
  sbsMatch: boolean;
}

export function decideSbsMismatchAction(input: DecideInput): SkipDecision {
  if (!input.hasActiveCandidate) return "create_new_primary";
  if (input.tariffMatch && input.sbsMatch) return "normal_extend";
  if (input.tariffMatch && !input.sbsMatch) return "skip_no_new_sub";
  return "create_new_tariff_mismatch";
}

export interface CandidateRow {
  subscription_v2_id: string;
  bepaid_sbs: string | null;
  tariff_id: string | null;
  status: string;
}

export interface AuditPayloadInput {
  orderId: string;
  productId: string;
  tariffId: string | null;
  paymentFlow: string;
  orderSbs: string | null;
  primaryCandidateId: string;
  primaryCandidateSbs: string | null;
  candidates: CandidateRow[];
}

export function buildSbsMismatchAuditPayload(input: AuditPayloadInput) {
  return {
    action: "grant-access-for-order.skip_extend_bepaid_subscription_mismatch.no_new_sub",
    actor_type: "system" as const,
    actor_user_id: null,
    actor_label: "grant-access-for-order",
    meta: {
      order_id: input.orderId,
      product_id: input.productId,
      tariff_id: input.tariffId,
      payment_flow: input.paymentFlow,
      order_bepaid_subscription_id: input.orderSbs,
      primary_candidate_subscription_v2_id: input.primaryCandidateId,
      primary_candidate_bepaid_sbs: input.primaryCandidateSbs,
      candidate_sub_ids: input.candidates.map((c) => c.subscription_v2_id),
      candidate_sbs_list: input.candidates,
      matched_by_tariff: true,
      matched_by_sbs: false,
      decision: "no_new_sub_chain" as const,
      reason:
        "bePaid subscription_id mismatch — refusing to extend OR create-new via foreign rebill",
    },
  };
}

export interface OrderMetaMergeInput {
  existingMeta: Record<string, unknown>;
  orderSbs: string | null;
  primaryCandidateId: string;
  primaryCandidateSbs: string | null;
  candidates: CandidateRow[];
  paymentFlow: string;
  nowIso: string;
}

export function buildSbsMismatchOrderMetaMerge(input: OrderMetaMergeInput) {
  return {
    ...input.existingMeta,
    manual_review: true,
    manual_review_reason: "bepaid_subscription_mismatch",
    manual_review_at: input.nowIso,
    manual_review_context: {
      order_bepaid_sbs: input.orderSbs,
      candidate_subscription_v2_id: input.primaryCandidateId,
      candidate_bepaid_sbs: input.primaryCandidateSbs,
      candidate_sub_ids: input.candidates.map((c) => c.subscription_v2_id),
      candidate_sbs_list: input.candidates,
      payment_flow: input.paymentFlow,
      decision: "no_new_sub_chain" as const,
    },
  };
}

export interface ResponseBodyInput {
  orderSbs: string | null;
  primaryCandidateId: string;
  primaryCandidateSbs: string | null;
  candidates: CandidateRow[];
}

export function buildSbsMismatchResponseBody(input: ResponseBodyInput) {
  const candidateIds = input.candidates.map((c) => c.subscription_v2_id);
  return {
    success: true,
    skipped: true,
    manual_review: true,
    manualReview: true,
    reason: "bepaid_subscription_mismatch" as const,
    granted_subscription_v2_id: null,
    grantedSubscriptionV2Id: null,
    granted_entitlement_id: null,
    grantedEntitlementId: null,
    subscription_id: null,
    subscription_v2_id: null,
    entitlement_id: null,
    message:
      "SBS mismatch: рабочая sub под другой bePaid subscription. Требуется ручная проверка.",
    manual_review_context: {
      order_bepaid_sbs: input.orderSbs,
      primary_candidate_subscription_v2_id: input.primaryCandidateId,
      primary_candidate_bepaid_sbs: input.primaryCandidateSbs,
      candidate_sub_ids: candidateIds,
    },
  };
}

export function resolvePaymentFlow(order: any): string {
  const meta = (order?.meta || {}) as Record<string, unknown>;
  return String(meta.payment_flow || order?.payment_flow || "");
}
