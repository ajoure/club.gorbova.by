// §A REBILL Materialization — pure builders.
// Все функции — без side-effects, тестируются оффлайн.
// SOT канонических полей REBILL-order и helper'ов для kill-switch / full-refund guard.

export type KillSwitchMode = "off" | "dry_run" | "on";

/**
 * Читает env-флаг BEPAID_REBILL_MATERIALIZATION.
 * Default: "off". Любое неизвестное значение → "off" (safe-by-default).
 */
export function resolveKillSwitchMode(envValue: string | null | undefined): KillSwitchMode {
  const v = (envValue || "").trim().toLowerCase();
  if (v === "on") return "on";
  if (v === "dry_run" || v === "dryrun" || v === "dry-run") return "dry_run";
  return "off";
}

/**
 * Канонический формат order_number для REBILL-orders.
 * Production-паттерн: `REBILL-<first 11 chars of payment uuid>`,
 * напр. `REBILL-7a64cd04-3d0`. UUID имеет вид `xxxxxxxx-xxxx-...`,
 * первые 11 символов = 8 hex + дефис + 3 hex.
 */
export function buildRebillOrderNumber(providerPaymentUid: string): string {
  if (!providerPaymentUid || typeof providerPaymentUid !== "string") {
    throw new Error("buildRebillOrderNumber: providerPaymentUid required");
  }
  return `REBILL-${providerPaymentUid.slice(0, 12)}`;
}

export interface RebillOrderPayloadInput {
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
  payment: {
    uid: string;
    amount: number;
    paid_at: string;
    currency?: string | null;
  };
  subscriptionId: string | null;
  materializationRun: string;
}

/**
 * Payload для INSERT в orders_v2 (REBILL-row).
 * Не содержит `id` — генерится gen_random_uuid() в БД.
 * Никаких side-effects.
 */
export function buildRebillOrderPayload(input: RebillOrderPayloadInput) {
  const parentMeta = (input.parentOrder.meta || {}) as Record<string, unknown>;
  const dealMonth = formatDealMonthMinsk(input.payment.paid_at);

  return {
    order_number: buildRebillOrderNumber(input.payment.uid),
    user_id: input.parentOrder.user_id,
    profile_id: input.parentOrder.profile_id,
    product_id: input.parentOrder.product_id,
    tariff_id: input.parentOrder.tariff_id,
    currency: input.payment.currency || input.parentOrder.currency || "BYN",
    status: "paid" as const,
    final_price: input.payment.amount,
    paid_amount: input.payment.amount,
    provider: "bepaid" as const,
    provider_payment_id: input.payment.uid,
    bepaid_subscription_id: input.subscriptionId,
    pipeline_id: input.parentOrder.pipeline_id,
    pipeline_stage_id: input.parentOrder.pipeline_stage_id,
    customer_email: input.parentOrder.customer_email,
    customer_phone: input.parentOrder.customer_phone,
    payer_type: input.parentOrder.payer_type,
    created_at: input.payment.paid_at,
    updated_at: new Date(input.payment.paid_at).toISOString(),
    deal_date: input.payment.paid_at,
    meta: {
      source: "bepaid_rebill",
      payment_flow: "bepaid_subscription_charge",
      parent_order_id: input.parentOrder.id,
      materialized_from_payment_uid: input.payment.uid,
      materialization_run: input.materializationRun,
      deal_month: dealMonth,
      // do_not_grant_access НЕ ставим: REBILL-order — единый source для grant.
      original_parent_payment_flow: parentMeta.payment_flow ?? null,
    },
  };
}

function formatDealMonthMinsk(iso: string): string {
  const d = new Date(iso);
  // Europe/Minsk = UTC+3 (без DST с 2011)
  const minsk = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const y = minsk.getUTCFullYear();
  const m = String(minsk.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export interface PaymentRowForRefundCheck {
  amount: number;
  status: string | null;
  transaction_type?: string | null;
  refunded_amount?: number | null;
  meta?: Record<string, unknown> | null;
  provider_payment_id?: string | null;
  id?: string | null;
}

/**
 * Full-refund guard. Возвращает true, если order на момент webhook'а уже полностью возвращён.
 * Формула совпадает с classifier из mem://commercial-logic/orders/partial-refund-state:
 *   paidSum = Σ amount (amount > 0, не refund-row, status ∈ paid/succeeded/refunded)
 *   refundedSum = Σ refunded_amount (non-refund) + Σ |amount| orphan refund-rows
 *   isFullRefund = refundedSum > 0 && paidSum > 0 && refundedSum + 0.01 >= paidSum
 */
export function isOrderFullyRefunded(payments: PaymentRowForRefundCheck[]): boolean {
  if (!payments || payments.length === 0) return false;

  const isRefundRow = (p: PaymentRowForRefundCheck): boolean => {
    const t = String(p.transaction_type || "").toLowerCase();
    if (t.includes("refund") || t.includes("возврат")) return true;
    const metaType = String((p.meta || {} as any).type || "").toLowerCase();
    if (metaType === "refund") return true;
    if ((p.amount ?? 0) < 0) return true;
    return false;
  };

  let paidSum = 0;
  let parentRefundedSum = 0;
  let legacyRefundedSum = 0;

  // index parents by id and provider_payment_id
  const parentById = new Map<string, PaymentRowForRefundCheck>();
  const parentByUid = new Map<string, PaymentRowForRefundCheck>();
  for (const p of payments) {
    if (!isRefundRow(p)) {
      if (p.id) parentById.set(String(p.id), p);
      if (p.provider_payment_id) parentByUid.set(String(p.provider_payment_id), p);
    }
  }

  for (const p of payments) {
    if (isRefundRow(p)) {
      const meta = (p.meta || {}) as any;
      const parentId = meta.parent_payment_id ? String(meta.parent_payment_id) : null;
      const parentUid = meta.parent_payment_uid ? String(meta.parent_payment_uid) : null;
      const parent =
        (parentId && parentById.get(parentId)) ||
        (parentUid && parentByUid.get(parentUid)) ||
        null;
      if (!parent || !parent.refunded_amount || parent.refunded_amount <= 0) {
        legacyRefundedSum += Math.abs(p.amount ?? 0);
      }
      continue;
    }
    const status = String(p.status || "").toLowerCase();
    if (status === "paid" || status === "succeeded" || status === "refunded") {
      if ((p.amount ?? 0) > 0) paidSum += p.amount;
    }
    if (p.refunded_amount && p.refunded_amount > 0) {
      parentRefundedSum += p.refunded_amount;
    }
  }

  const refundedSum = parentRefundedSum + legacyRefundedSum;
  if (refundedSum <= 0 || paidSum <= 0) return false;
  return refundedSum + 0.01 >= paidSum;
}

export interface ClassifyAutochargeInput {
  hasSubscriptionId: boolean;
  hasMatchingSubscriptionV2: boolean;
  transactionStatus: string | null | undefined;
  // признак того, что это НЕ первый платёж под этой sbs:
  // есть предыдущий successful payment под этим sbs ИЛИ subscription уже активна.
  hasPriorSuccessfulPayment: boolean;
}

export type RecurringClassification =
  | "recurring_autocharge"
  | "initial_subscription_charge"
  | "not_subscription";

export function classifyRecurringAutocharge(
  input: ClassifyAutochargeInput,
): RecurringClassification {
  if (!input.hasSubscriptionId || !input.hasMatchingSubscriptionV2) return "not_subscription";
  const status = String(input.transactionStatus || "").toLowerCase();
  if (status !== "successful" && status !== "paid" && status !== "success") {
    return "not_subscription";
  }
  return input.hasPriorSuccessfulPayment ? "recurring_autocharge" : "initial_subscription_charge";
}
