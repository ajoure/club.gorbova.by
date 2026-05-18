// §A.2 REBILL Materialization — orchestrator (mode=on wired).
// Принимает deps (supabase-like, grant-invoker), возвращает decision + signal.
// Все БД-операции — через deps interface; offline-тесты через faked deps.
//
// Модель идемпотентности:
//   orders_v2 имеет UNIQUE (order_number). REBILL order_number = `REBILL-<first 12 chars uid>`.
//   Race-safety: при unique-violation INSERT → re-fetch by order_number → treat as resume.
//   payments_v2 НЕ имеет unique по provider_payment_id, поэтому используем SELECT-then-INSERT/UPDATE.
//
// Resume-семантика (amendment 2/3/4):
//   Если REBILL уже создан — читаем meta.materialization_status / meta.grant_status.
//   - grant_status='success' → skip (handled).
//   - иначе → пытаемся доделать недостающие шаги (repoint payment / invoke grant).
//
// Full-refund guard (amendment 1):
//   Проверяем refunds против ТЕКУЩЕГО payment uid (а не parent-order).
//   Если по uid уже есть refund-row(ы), сумма которых ≥ amount → grant skip.
//
// Conflict (amendment 5):
//   manual_review мерджим на конфликтующий order (где висит payment), parent — context.
//
// Repoint (amendment 6,7):
//   - INSERT, если payment с этим uid отсутствует;
//   - UPDATE order_id, ТОЛЬКО если transaction_type ∈ {Платеж, payment};
//   - refund-row не трогаем.

import {
  buildRebillOrderNumber,
  buildRebillOrderPayload,
  isOrderFullyRefunded as _legacyParentRefundCheck,
  type KillSwitchMode,
  type PaymentRowForRefundCheck,
} from "./rebill_builders.ts";

export interface RebillFlowInput {
  mode: KillSwitchMode;
  parentOrder: {
    id: string;
    user_id: string | null;
    profile_id: string | null;
    product_id: string | null;
    tariff_id: string | null;
    currency: string | null;
    pipeline_id: string | null;
    pipeline_stage_id: string | null;
    bepaid_subscription_id: string | null;
    customer_email: string | null;
    customer_phone: string | null;
    payer_type: string | null;
    meta?: Record<string, unknown> | null;
  };
  payment: { uid: string; amount: number; paid_at: string; currency?: string | null };
  subscriptionId: string | null;
}

export type RebillDecision =
  | "off_noop"
  | "idempotent_skip"            // REBILL exists + grant already success
  | "resumed_repoint_only"       // REBILL exists, repoint payment, no grant needed (full-refund) / or completed
  | "resumed_grant"              // REBILL exists, retried grant
  | "conflict_uid"
  | "skip_grant_full_refunded"   // payment uid сам уже refunded
  | "skip_sbs_mismatch_pre_check"
  | "dry_run_planned"
  | "materialized"               // happy path: insert + repoint + grant ok
  | "materialized_partial"       // insert ok, repoint failed → retryable
  | "materialized_grant_failed"; // insert + repoint ok, grant failed → retryable

export interface RebillFlowResult {
  decision: RebillDecision;
  mode: KillSwitchMode;
  /**
   * proceedLegacy=true — caller should run the existing legacy grant path.
   * proceedLegacy=false — caller MUST short-circuit (REBILL handled the grant
   * fully or recorded a manual_review marker; legacy must not double-grant).
   *
   * Rules:
   *   off       → proceedLegacy=true (no-op, legacy unchanged)
   *   dry_run   → proceedLegacy=true (observability only)
   *   on terminal (any decision other than off_noop) → proceedLegacy=false
   */
  proceedLegacy: boolean;
  rebill_order_id?: string | null;
  existing_rebill_order_id?: string | null;
  conflicting_order_id?: string | null;
  reason?: string;
  planned_payload?: Record<string, unknown>;
  grant_result?: unknown;
}

export interface ExistingRebillSummary {
  id: string;
  order_number: string;
  meta: Record<string, unknown> | null;
}

export interface PaymentRow {
  id: string;
  order_id: string | null;
  transaction_type?: string | null;
  amount?: number | null;
  status?: string | null;
}

export interface RebillFlowDeps {
  // Idempotency by canonical REBILL order_number (UNIQUE in orders_v2).
  findRebillOrderByOrderNumber: (orderNumber: string) => Promise<ExistingRebillSummary | null>;
  // Conflict: payment with same uid already linked to a non-REBILL order.
  // Returns the main payment row (Платеж/payment), refunds excluded.
  findMainPaymentByUid: (uid: string) => Promise<PaymentRow | null>;
  // Refunds tied to the CURRENT payment uid (amendment 1).
  // Sum of |amount| where refund-row links to this uid.
  sumRefundsForPaymentUid: (uid: string) => Promise<number>;
  // SBS mismatch pre-check (semantic copy of §F).
  checkSbsMismatchBeforeRebill: (input: {
    userId: string | null;
    productId: string | null;
    tariffId: string | null;
    incomingSbs: string | null;
  }) => Promise<{ mismatch: boolean; foreignSbs?: string | null; candidateSubId?: string | null }>;
  // INSERT orders_v2; on UNIQUE (order_number) violation throws an Error
  // with message containing 'duplicate key' or code '23505' — caller treats as resume.
  insertRebillOrder: (
    payload: Record<string, unknown>,
  ) => Promise<{ id: string; conflict?: boolean }>;
  // Explicit split (amendment 6):
  insertPaymentRow: (input: {
    rebill_order_id: string;
    payment_uid: string;
    payment: { amount: number; paid_at: string; currency?: string | null };
    subscriptionId: string | null;
    userId: string | null;
    profileId: string | null;
  }) => Promise<{ payment_id: string }>;
  updatePaymentOrderId: (input: {
    payment_id: string;
    rebill_order_id: string;
  }) => Promise<void>;
  // Invoke canonical write-path; throws on transport/HTTP failure.
  invokeGrantAccess: (rebillOrderId: string) => Promise<unknown>;
  // Patch meta on an order (parent OR rebill OR conflicting).
  mergeOrderMeta: (input: {
    orderId: string;
    patch: Record<string, unknown>;
  }) => Promise<void>;
  writeAudit: (input: { action: string; meta: Record<string, unknown> }) => Promise<void>;
}

const MATERIALIZATION_RUN = "bepaid_webhook_rebill_v2";

export async function runRebillFlow(
  deps: RebillFlowDeps,
  input: RebillFlowInput,
): Promise<RebillFlowResult> {
  const { mode } = input;

  if (mode === "off") {
    return { decision: "off_noop", mode, proceedLegacy: true };
  }

  const baseMeta = {
    mode,
    uid: input.payment.uid,
    sbs: input.subscriptionId,
    parent_order_id: input.parentOrder.id,
    payment_flow: "bepaid_subscription_charge",
  };

  // 1) SBS mismatch pre-check
  const sbsCheck = await deps.checkSbsMismatchBeforeRebill({
    userId: input.parentOrder.user_id,
    productId: input.parentOrder.product_id,
    tariffId: input.parentOrder.tariff_id,
    incomingSbs: input.subscriptionId,
  });
  if (sbsCheck.mismatch) {
    await deps.mergeOrderMeta({
      orderId: input.parentOrder.id,
      patch: {
        manual_review: true,
        rebill_sbs_mismatch_pre_check: {
          incoming_sbs: input.subscriptionId,
          foreign_sbs: sbsCheck.foreignSbs ?? null,
          candidate_subscription_v2_id: sbsCheck.candidateSubId ?? null,
          payment_uid: input.payment.uid,
          at: new Date().toISOString(),
        },
      },
    });
    await deps.writeAudit({
      action: "bepaid.rebill.skip_sbs_mismatch_pre_check",
      meta: { ...baseMeta, decision: "skip_sbs_mismatch_pre_check",
        foreign_sbs: sbsCheck.foreignSbs ?? null,
        candidate_subscription_v2_id: sbsCheck.candidateSubId ?? null },
    });
    return {
      decision: "skip_sbs_mismatch_pre_check",
      mode, proceedLegacy: false,
      reason: "bepaid_subscription_mismatch",
    };
  }

  // 2) full-refund guard ON CURRENT payment uid (amendment 1)
  const refundedSum = await deps.sumRefundsForPaymentUid(input.payment.uid);
  const fullyRefunded =
    refundedSum > 0 && refundedSum + 0.01 >= (input.payment.amount ?? 0);

  // 3) idempotency by REBILL order_number (UNIQUE)
  const orderNumber = buildRebillOrderNumber(input.payment.uid);
  const existing = await deps.findRebillOrderByOrderNumber(orderNumber);

  // ---------- DRY RUN ----------
  if (mode === "dry_run") {
    const plannedPayload = buildRebillOrderPayload({
      parentOrder: input.parentOrder,
      payment: input.payment,
      subscriptionId: input.subscriptionId,
      materializationRun: MATERIALIZATION_RUN,
    });
    const existingPayment = await deps.findMainPaymentByUid(input.payment.uid);
    await deps.writeAudit({
      action: "bepaid.rebill.dry_run",
      meta: {
        ...baseMeta,
        decision: existing
          ? "would_resume"
          : (fullyRefunded ? "would_skip_grant_full_refunded" : "would_materialize"),
        planned_order_payload: plannedPayload,
        planned_payment_repoint: {
          existing_payment_id: existingPayment?.id ?? null,
          existing_order_id: existingPayment?.order_id ?? null,
          will_create_payment: !existingPayment,
          will_repoint_to: existing?.id ?? "<new_rebill_order_id>",
        },
        planned_grant_call: fullyRefunded ? null : {
          fn: "grant-access-for-order",
          args: { order_id: existing?.id ?? "<new_rebill_order_id>" },
        },
        existing_rebill_order_id: existing?.id ?? null,
        full_refunded_uid: fullyRefunded,
      },
    });
    return {
      decision: "dry_run_planned",
      mode, proceedLegacy: true, // dry_run: legacy keeps running
      planned_payload: plannedPayload,
    };
  }

  // ---------- mode=on path ----------
  // 3a) Resume if REBILL exists.
  if (existing) {
    const meta = (existing.meta || {}) as Record<string, unknown>;
    const grantStatus = String(meta.grant_status || "");
    if (grantStatus === "success") {
      await deps.writeAudit({
        action: "bepaid.rebill.idempotent_skip",
        meta: { ...baseMeta, decision: "idempotent_skip",
          existing_rebill_order_id: existing.id, grant_status: "success" },
      });
      return {
        decision: "idempotent_skip", mode, proceedLegacy: false,
        existing_rebill_order_id: existing.id,
      };
    }

    // Resume: ensure payment is repointed, then (re)try grant unless full-refunded.
    const repoint = await ensurePaymentRepointed(deps, {
      rebill_order_id: existing.id,
      payment_uid: input.payment.uid,
      payment: input.payment,
      subscriptionId: input.subscriptionId,
      userId: input.parentOrder.user_id,
      profileId: input.parentOrder.profile_id,
    });
    if (!repoint.ok) {
      await deps.mergeOrderMeta({
        orderId: existing.id,
        patch: {
          materialization_status: "partial_payment_repoint_failed",
          manual_review: true,
          last_repoint_error: repoint.error || "unknown",
          last_attempt_at: new Date().toISOString(),
        },
      });
      await deps.writeAudit({
        action: "bepaid.rebill.materialized_partial",
        meta: { ...baseMeta, decision: "materialized_partial",
          rebill_order_id: existing.id, error: repoint.error || "unknown",
          phase: "resume_repoint" },
      });
      return {
        decision: "materialized_partial", mode, proceedLegacy: false,
        rebill_order_id: existing.id,
      };
    }

    if (fullyRefunded) {
      await deps.mergeOrderMeta({
        orderId: existing.id,
        patch: { materialization_status: "skipped_grant_full_refunded",
          full_refunded_uid: true, last_attempt_at: new Date().toISOString() },
      });
      await deps.writeAudit({
        action: "bepaid.rebill.skip_grant_full_refunded",
        meta: { ...baseMeta, decision: "skip_grant_full_refunded",
          rebill_order_id: existing.id, refunded_sum: refundedSum,
          phase: "resume" },
      });
      return {
        decision: "resumed_repoint_only", mode, proceedLegacy: false,
        rebill_order_id: existing.id,
      };
    }

    const grant = await safeInvokeGrant(deps, existing.id);
    if (grant.ok) {
      await deps.mergeOrderMeta({
        orderId: existing.id,
        patch: { materialization_status: "success", grant_status: "success",
          manual_review: false, last_attempt_at: new Date().toISOString() },
      });
      await deps.writeAudit({
        action: "bepaid.rebill.materialized",
        meta: { ...baseMeta, decision: "resumed_grant",
          rebill_order_id: existing.id, grant_result: grant.result, phase: "resume" },
      });
      return {
        decision: "resumed_grant", mode, proceedLegacy: false,
        rebill_order_id: existing.id, grant_result: grant.result,
      };
    } else {
      await deps.mergeOrderMeta({
        orderId: existing.id,
        patch: { materialization_status: "grant_failed", grant_status: "failed",
          manual_review: true, last_grant_error: grant.error,
          last_attempt_at: new Date().toISOString() },
      });
      await deps.writeAudit({
        action: "bepaid.rebill.materialized_grant_failed",
        meta: { ...baseMeta, decision: "materialized_grant_failed",
          rebill_order_id: existing.id, error: grant.error, phase: "resume" },
      });
      return {
        decision: "materialized_grant_failed", mode, proceedLegacy: false,
        rebill_order_id: existing.id, grant_result: { error: grant.error },
      };
    }
  }

  // 3b) New REBILL: conflict check before INSERT.
  const existingPayment = await deps.findMainPaymentByUid(input.payment.uid);
  if (
    existingPayment && existingPayment.order_id &&
    existingPayment.order_id !== input.parentOrder.id
  ) {
    // Mark conflicting order (amendment 5) AND parent as context.
    await deps.mergeOrderMeta({
      orderId: existingPayment.order_id,
      patch: {
        manual_review: true,
        rebill_conflict_uid: {
          payment_uid: input.payment.uid,
          existing_payment_id: existingPayment.id,
          incoming_parent_order_id: input.parentOrder.id,
          at: new Date().toISOString(),
        },
      },
    });
    await deps.mergeOrderMeta({
      orderId: input.parentOrder.id,
      patch: {
        rebill_conflict_uid_context: {
          payment_uid: input.payment.uid,
          existing_payment_id: existingPayment.id,
          conflicting_order_id: existingPayment.order_id,
          at: new Date().toISOString(),
        },
      },
    });
    await deps.writeAudit({
      action: "bepaid.rebill.conflict_uid",
      meta: { ...baseMeta, decision: "conflict_uid",
        existing_payment_id: existingPayment.id,
        conflicting_order_id: existingPayment.order_id },
    });
    return {
      decision: "conflict_uid", mode, proceedLegacy: false,
      conflicting_order_id: existingPayment.order_id, reason: "conflict_uid",
    };
  }

  // 3c) INSERT REBILL-order. Race-safe via UNIQUE order_number.
  const plannedPayload = buildRebillOrderPayload({
    parentOrder: input.parentOrder,
    payment: input.payment,
    subscriptionId: input.subscriptionId,
    materializationRun: MATERIALIZATION_RUN,
  });

  let rebillOrderId: string;
  try {
    const ins = await deps.insertRebillOrder(plannedPayload);
    rebillOrderId = ins.id;
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (/duplicate key|23505|order_number/i.test(msg)) {
      // Race winner: someone else inserted REBILL between findRebillOrderByOrderNumber and insertRebillOrder.
      const after = await deps.findRebillOrderByOrderNumber(orderNumber);
      if (!after) {
        await deps.writeAudit({
          action: "bepaid.rebill.materialized_partial",
          meta: { ...baseMeta, decision: "materialized_partial",
            phase: "race_resolve", error: msg },
        });
        return { decision: "materialized_partial", mode, proceedLegacy: false };
      }
      // Treat as resume.
      const resumeInput: RebillFlowInput = { ...input };
      // single-shot recursion: existing branch will handle.
      return await runRebillFlow(deps, resumeInput);
    }
    // Unknown insert error
    await deps.writeAudit({
      action: "bepaid.rebill.materialized_partial",
      meta: { ...baseMeta, decision: "materialized_partial",
        phase: "insert_rebill", error: msg },
    });
    return { decision: "materialized_partial", mode, proceedLegacy: false };
  }

  // 3d) Repoint or insert payment row.
  const repoint = await ensurePaymentRepointed(deps, {
    rebill_order_id: rebillOrderId,
    payment_uid: input.payment.uid,
    payment: input.payment,
    subscriptionId: input.subscriptionId,
    userId: input.parentOrder.user_id,
    profileId: input.parentOrder.profile_id,
  });
  if (!repoint.ok) {
    await deps.mergeOrderMeta({
      orderId: rebillOrderId,
      patch: {
        materialization_status: "partial_payment_repoint_failed",
        manual_review: true,
        last_repoint_error: repoint.error || "unknown",
        last_attempt_at: new Date().toISOString(),
      },
    });
    await deps.writeAudit({
      action: "bepaid.rebill.materialized_partial",
      meta: { ...baseMeta, decision: "materialized_partial",
        rebill_order_id: rebillOrderId, error: repoint.error || "unknown",
        phase: "fresh_repoint" },
    });
    return {
      decision: "materialized_partial", mode, proceedLegacy: false,
      rebill_order_id: rebillOrderId,
    };
  }

  // 3e) Full-refund guard for current uid.
  if (fullyRefunded) {
    await deps.mergeOrderMeta({
      orderId: rebillOrderId,
      patch: { materialization_status: "skipped_grant_full_refunded",
        full_refunded_uid: true, last_attempt_at: new Date().toISOString() },
    });
    await deps.writeAudit({
      action: "bepaid.rebill.skip_grant_full_refunded",
      meta: { ...baseMeta, decision: "skip_grant_full_refunded",
        rebill_order_id: rebillOrderId, refunded_sum: refundedSum },
    });
    return {
      decision: "skip_grant_full_refunded", mode, proceedLegacy: false,
      rebill_order_id: rebillOrderId,
    };
  }

  // 3f) Invoke grant.
  const grant = await safeInvokeGrant(deps, rebillOrderId);
  if (grant.ok) {
    // PATCH-RB1.2: post-rebind verification BEFORE writing materialized.
    // payments_v2.order_id must equal rebill_order_id; otherwise downgrade.
    const verify = await deps.findMainPaymentByUid(input.payment.uid);
    if (!verify || verify.order_id !== rebillOrderId) {
      await deps.mergeOrderMeta({
        orderId: rebillOrderId,
        patch: { materialization_status: "partial_payment_rebind_post_check_failed",
          manual_review: true,
          last_post_check_payment_id: verify?.id ?? null,
          last_post_check_order_id: verify?.order_id ?? null,
          last_attempt_at: new Date().toISOString() },
      });
      await deps.writeAudit({
        action: "bepaid.rebill.payment_rebind_post_check_failed",
        meta: { ...baseMeta, decision: "materialized_partial",
          rebill_order_id: rebillOrderId,
          payment_id: verify?.id ?? null,
          actual_order_id: verify?.order_id ?? null,
          phase: "post_grant_verify",
          severity: "CRITICAL" },
      });
      return {
        decision: "materialized_partial", mode, proceedLegacy: false,
        rebill_order_id: rebillOrderId, grant_result: grant.result,
        reason: "payment_rebind_post_check_failed",
      };
    }
    await deps.mergeOrderMeta({
      orderId: rebillOrderId,
      patch: { materialization_status: "success", grant_status: "success",
        manual_review: false, last_attempt_at: new Date().toISOString() },
    });
    await deps.writeAudit({
      action: "bepaid.rebill.materialized",
      meta: { ...baseMeta, decision: "materialized",
        rebill_order_id: rebillOrderId, grant_result: grant.result },
    });
    return {
      decision: "materialized", mode, proceedLegacy: false,
      rebill_order_id: rebillOrderId, grant_result: grant.result,
    };
  } else {
    await deps.mergeOrderMeta({
      orderId: rebillOrderId,
      patch: { materialization_status: "grant_failed", grant_status: "failed",
        manual_review: true, last_grant_error: grant.error,
        last_attempt_at: new Date().toISOString() },
    });
    await deps.writeAudit({
      action: "bepaid.rebill.materialized_grant_failed",
      meta: { ...baseMeta, decision: "materialized_grant_failed",
        rebill_order_id: rebillOrderId, error: grant.error },
    });
    return {
      decision: "materialized_grant_failed", mode, proceedLegacy: false,
      rebill_order_id: rebillOrderId, grant_result: { error: grant.error },
    };
  }
}

// ---- helpers ----

async function ensurePaymentRepointed(
  deps: RebillFlowDeps,
  args: {
    rebill_order_id: string;
    payment_uid: string;
    payment: { amount: number; paid_at: string; currency?: string | null };
    subscriptionId: string | null;
    userId: string | null;
    profileId: string | null;
  },
): Promise<{ ok: true; payment_id: string; created: boolean } | { ok: false; error: string }> {
  try {
    const existing = await deps.findMainPaymentByUid(args.payment_uid);
    if (existing) {
      // amendment 7: only repoint main payment row.
      const t = String(existing.transaction_type || "").toLowerCase();
      const isMain = t === "платеж" || t === "payment";
      if (!isMain) {
        return { ok: false, error: `unexpected_transaction_type:${existing.transaction_type}` };
      }
      if (existing.order_id !== args.rebill_order_id) {
        await deps.updatePaymentOrderId({
          payment_id: existing.id, rebill_order_id: args.rebill_order_id,
        });
      }
      return { ok: true, payment_id: existing.id, created: false };
    }
    const ins = await deps.insertPaymentRow({
      rebill_order_id: args.rebill_order_id,
      payment_uid: args.payment_uid,
      payment: args.payment,
      subscriptionId: args.subscriptionId,
      userId: args.userId,
      profileId: args.profileId,
    });
    return { ok: true, payment_id: ins.payment_id, created: true };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

async function safeInvokeGrant(
  deps: RebillFlowDeps,
  rebillOrderId: string,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  try {
    const result = await deps.invokeGrantAccess(rebillOrderId);
    // Heuristic: grant-access-for-order usually returns { success: true } или { error }.
    const r = (result || {}) as Record<string, unknown>;
    if (r && (r.error || r.success === false)) {
      return { ok: false, error: String(r.error || "grant_returned_failure") };
    }
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

// re-export for backward compatibility (test helper)
export const _internal = { _legacyParentRefundCheck };
