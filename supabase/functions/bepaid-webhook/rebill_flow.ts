// §A REBILL Materialization — orchestrator.
// Принимает deps (supabase-like, grant-invoker), возвращает decision.
// Все БД-операции — через deps interface, что делает оффлайн-тесты возможными.
//
// Поведение по mode:
//   off     — вообще не вызывается из webhook (caller short-circuits).
//             Если случайно вызвали — return { skipped: true, mode:"off" }, без аудита.
//   dry_run — выполняем resolve/idempotency/conflict/full-refund checks,
//             пишем audit `bepaid.rebill.dry_run` с planned payload, БЕЗ DML/grant.
//   on      — выполняем INSERT REBILL-order, repoint payment, invoke grant.
//
// Критично: §F SBS-mismatch guard НЕ дублируется здесь. Если упадёт после
// invoke grant — это §F internal logic; rebillFlow вызывает grant и доверяет
// §F. Локально мы только ловим заведомо-чужой sbs ДО создания REBILL-order
// (см. guardSbsTariffMatch в deps), чтобы не плодить REBILL-orders без grant.

import {
  buildRebillOrderPayload,
  isOrderFullyRefunded,
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
  | "idempotent_skip"
  | "conflict_uid"
  | "skip_grant_full_refunded"
  | "skip_sbs_mismatch_pre_check"
  | "dry_run_planned"
  | "materialized";

export interface RebillFlowResult {
  decision: RebillDecision;
  mode: KillSwitchMode;
  rebill_order_id?: string | null;
  existing_rebill_order_id?: string | null;
  conflicting_order_id?: string | null;
  reason?: string;
  planned_payload?: Record<string, unknown>;
  grant_result?: unknown;
}

export interface RebillFlowDeps {
  // SELECT orders_v2 WHERE provider='bepaid' AND provider_payment_id=uid
  findRebillOrderByPaymentUid: (uid: string) => Promise<{ id: string } | null>;
  // SELECT payments_v2 WHERE provider_payment_id=uid (single)
  findPaymentByUid: (uid: string) => Promise<{ id: string; order_id: string | null } | null>;
  // SELECT payments_v2 WHERE order_id=parentOrder.id  (для full-refund guard над parent перед REBILL)
  // NOTE: full-refund guard в этом patch проверяется ПО parent-order'у на момент webhook'а:
  // если parent уже full-refunded → не плодим REBILL и не зовём grant.
  listPaymentsForOrder: (orderId: string) => Promise<PaymentRowForRefundCheck[]>;
  // Локальный pre-check sbs match: если у нас уже есть active subscription по
  // (user, product, tariff) с ДРУГИМ bepaid_sbs — return true (mismatch).
  // Это совпадает по семантике с §F, но выполняется ДО REBILL INSERT.
  checkSbsMismatchBeforeRebill: (input: {
    userId: string | null;
    productId: string | null;
    tariffId: string | null;
    incomingSbs: string | null;
  }) => Promise<{ mismatch: boolean; foreignSbs?: string | null; candidateSubId?: string | null }>;
  insertRebillOrder: (payload: Record<string, unknown>) => Promise<{ id: string }>;
  upsertPaymentForRebill: (input: {
    rebill_order_id: string;
    parent_order_id: string;
    payment_uid: string;
    payment: { amount: number; paid_at: string; currency?: string | null };
    subscriptionId: string | null;
    userId: string | null;
    profileId: string | null;
  }) => Promise<{ payment_id: string; repointed_from_order_id: string | null }>;
  invokeGrantAccess: (rebillOrderId: string) => Promise<unknown>;
  mergeOrderMetaManualReview: (input: {
    orderId: string;
    reason: string;
    context: Record<string, unknown>;
  }) => Promise<void>;
  writeAudit: (input: {
    action: string;
    meta: Record<string, unknown>;
  }) => Promise<void>;
}

const MATERIALIZATION_RUN = "bepaid_webhook_rebill_v1";

export async function runRebillFlow(
  deps: RebillFlowDeps,
  input: RebillFlowInput,
): Promise<RebillFlowResult> {
  const { mode } = input;

  // off — caller не должен вызывать. Защитный no-op без audit (по amendment 5).
  if (mode === "off") {
    return { decision: "off_noop", mode };
  }

  const baseMeta = {
    mode,
    uid: input.payment.uid,
    sbs: input.subscriptionId,
    parent_order_id: input.parentOrder.id,
    payment_flow: "bepaid_subscription_charge",
  };

  // 1) SBS mismatch pre-check (avoid spawning REBILL без доступа).
  const sbsCheck = await deps.checkSbsMismatchBeforeRebill({
    userId: input.parentOrder.user_id,
    productId: input.parentOrder.product_id,
    tariffId: input.parentOrder.tariff_id,
    incomingSbs: input.subscriptionId,
  });
  if (sbsCheck.mismatch) {
    await deps.mergeOrderMetaManualReview({
      orderId: input.parentOrder.id,
      reason: "rebill_sbs_mismatch_pre_check",
      context: {
        incoming_sbs: input.subscriptionId,
        foreign_sbs: sbsCheck.foreignSbs ?? null,
        candidate_subscription_v2_id: sbsCheck.candidateSubId ?? null,
        payment_uid: input.payment.uid,
      },
    });
    await deps.writeAudit({
      action: "bepaid.rebill.skip_sbs_mismatch_pre_check",
      meta: {
        ...baseMeta,
        decision: "skip_sbs_mismatch_pre_check",
        foreign_sbs: sbsCheck.foreignSbs ?? null,
        candidate_subscription_v2_id: sbsCheck.candidateSubId ?? null,
      },
    });
    return {
      decision: "skip_sbs_mismatch_pre_check",
      mode,
      reason: "bepaid_subscription_mismatch",
    };
  }

  // 2) idempotency by orders_v2.provider_payment_id
  const existingRebill = await deps.findRebillOrderByPaymentUid(input.payment.uid);
  if (existingRebill) {
    await deps.writeAudit({
      action: "bepaid.rebill.idempotent_skip",
      meta: {
        ...baseMeta,
        decision: "idempotent_skip",
        existing_rebill_order_id: existingRebill.id,
      },
    });
    return {
      decision: "idempotent_skip",
      mode,
      existing_rebill_order_id: existingRebill.id,
    };
  }

  // 3) conflict check: payment с этим uid существует, но привязан к чужому order
  const existingPayment = await deps.findPaymentByUid(input.payment.uid);
  if (
    existingPayment &&
    existingPayment.order_id &&
    existingPayment.order_id !== input.parentOrder.id
  ) {
    // Привязка к "чужому" order, который при этом не REBILL для этого uid
    // (см. п.2: REBILL для uid точно нет). → конфликт.
    await deps.mergeOrderMetaManualReview({
      orderId: input.parentOrder.id,
      reason: "rebill_conflict_uid",
      context: {
        payment_uid: input.payment.uid,
        existing_payment_id: existingPayment.id,
        conflicting_order_id: existingPayment.order_id,
      },
    });
    await deps.writeAudit({
      action: "bepaid.rebill.conflict_uid",
      meta: {
        ...baseMeta,
        decision: "conflict_uid",
        existing_payment_id: existingPayment.id,
        conflicting_order_id: existingPayment.order_id,
      },
    });
    return {
      decision: "conflict_uid",
      mode,
      conflicting_order_id: existingPayment.order_id,
      reason: "conflict_uid",
    };
  }

  // 4) build payload (pure)
  const plannedPayload = buildRebillOrderPayload({
    parentOrder: input.parentOrder,
    payment: input.payment,
    subscriptionId: input.subscriptionId,
    materializationRun: MATERIALIZATION_RUN,
  });

  // 5) full-refund guard — на parent-order (если parent уже full-refunded,
  //    подозрительно зовут rebill — не материализуем grant).
  const parentPayments = await deps.listPaymentsForOrder(input.parentOrder.id);
  const parentFullRefunded = isOrderFullyRefunded(parentPayments);

  // dry_run — только audit, никаких DML/grant
  if (mode === "dry_run") {
    await deps.writeAudit({
      action: "bepaid.rebill.dry_run",
      meta: {
        ...baseMeta,
        decision: parentFullRefunded ? "would_skip_grant_full_refunded" : "would_materialize",
        planned_order_payload: plannedPayload,
        planned_payment_repoint: {
          existing_payment_id: existingPayment?.id ?? null,
          existing_order_id: existingPayment?.order_id ?? null,
          will_create_payment: !existingPayment,
          will_repoint_to: "<new_rebill_order_id>",
        },
        planned_grant_call: parentFullRefunded
          ? null
          : { fn: "grant-access-for-order", args: { order_id: "<new_rebill_order_id>" } },
        parent_full_refunded: parentFullRefunded,
      },
    });
    return {
      decision: "dry_run_planned",
      mode,
      planned_payload: plannedPayload,
    };
  }

  // mode === "on" — реальные write-операции
  const inserted = await deps.insertRebillOrder(plannedPayload);
  const rebillOrderId = inserted.id;

  const upsert = await deps.upsertPaymentForRebill({
    rebill_order_id: rebillOrderId,
    parent_order_id: input.parentOrder.id,
    payment_uid: input.payment.uid,
    payment: input.payment,
    subscriptionId: input.subscriptionId,
    userId: input.parentOrder.user_id,
    profileId: input.parentOrder.profile_id,
  });

  // full-refund guard перед grant
  if (parentFullRefunded) {
    await deps.writeAudit({
      action: "bepaid.rebill.skip_grant_full_refunded",
      meta: {
        ...baseMeta,
        decision: "skip_grant_full_refunded",
        rebill_order_id: rebillOrderId,
        payment_id: upsert.payment_id,
      },
    });
    return {
      decision: "skip_grant_full_refunded",
      mode,
      rebill_order_id: rebillOrderId,
    };
  }

  let grantResult: unknown = null;
  try {
    grantResult = await deps.invokeGrantAccess(rebillOrderId);
  } catch (e) {
    grantResult = { error: String((e as Error)?.message || e) };
  }

  await deps.writeAudit({
    action: "bepaid.rebill.materialized",
    meta: {
      ...baseMeta,
      decision: "materialized",
      rebill_order_id: rebillOrderId,
      payment_id: upsert.payment_id,
      repointed_from_order_id: upsert.repointed_from_order_id,
      grant_result: grantResult,
    },
  });

  return {
    decision: "materialized",
    mode,
    rebill_order_id: rebillOrderId,
    grant_result: grantResult,
  };
}
