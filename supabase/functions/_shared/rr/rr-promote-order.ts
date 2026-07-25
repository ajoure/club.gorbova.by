/**
 * RR Sprint C1 — promotion + fulfillment orchestrator.
 *
 * Единственный оркестратор write-path после РР `authorized`.
 * Вызывается из:
 *   - rr-webhook (при notification с newStatus in {authorized, authorized_all})
 *   - rr-fulfill-order (admin retry / backfill)
 *
 * Контракт:
 *   1. RPC rr_promote_authorized_order — атомарно переводит order в paid и
 *      создаёт payments_v2. RPC ничего не знает про grant-access.
 *   2. Если RPC вернул should_grant_access=true — вызывает grant-access-for-order
 *      через HTTP (service key).
 *   3. По результату вызова обновляет meta.rr.fulfillment через
 *      rr_mark_fulfillment (completed | failed) и пишет provider_events.
 *
 * Идемпотентность:
 *   - state='already_promoted' + fulfillment.status='completed' → полный no-op.
 *   - state='already_promoted' + fulfillment.status!='completed' → retry grant.
 *   - Повторный webhook на promoted+completed заказ не создаёт эффектов.
 *
 * Никаких hardcode продуктов/тарифов/сумм. Всё берётся из orders_v2.
 */
import { finalizeComposablePurchase } from "../finalize-composable-purchase.ts";

export type RRPromoteSource = "rr-webhook" | "rr-fulfill-order" | "rr-reconciler";

export interface RRPromoteResult {
  ok: boolean;
  promote_state:
    | "promoted"
    | "already_promoted"
    | "ignored"
    | "wrong_provider"
    | "wrong_flow"
    | "not_found";
  fulfillment_state?: "completed" | "failed" | "skipped" | "not_needed";
  grant_status?: number;
  grant_error?: string;
  payment_id?: string | null;
  details?: Record<string, unknown>;
}

interface Deps {
  supabaseAdmin: any;
  supabaseUrl: string;
  serviceRoleKey: string;
}

export async function promoteAuthorizedRRPayment(
  deps: Deps,
  input: {
    orderId: string;
    source: RRPromoteSource;
    rrStatusRaw: string;
    signHashShort: string;
  },
): Promise<RRPromoteResult> {
  const { supabaseAdmin } = deps;
  const { orderId, source, rrStatusRaw, signHashShort } = input;

  // 1) Atomic promotion RPC.
  const { data: promoteRaw, error: promoteErr } = await supabaseAdmin.rpc(
    "rr_promote_authorized_order",
    {
      _order_id: orderId,
      _source: source,
      _rr_status_raw: rrStatusRaw,
      _sign_hash_short: signHashShort,
    },
  );

  if (promoteErr) {
    await recordEvent(supabaseAdmin, orderId, "rr_promotion_rpc_failed", {
      source,
      rr_status_raw: rrStatusRaw,
      error: promoteErr.message,
    });
    return {
      ok: false,
      promote_state: "not_found",
      details: { rpc_error: promoteErr.message },
    };
  }

  const promote = (promoteRaw ?? {}) as Record<string, any>;
  const state = String(promote.state ?? "not_found") as RRPromoteResult["promote_state"];
  const shouldGrant = promote.should_grant_access === true;
  const paymentId = (promote.payment_id ?? null) as string | null;

  // Non-actionable terminal states — record and exit.
  if (state === "ignored" || state === "wrong_provider" || state === "wrong_flow" || state === "not_found") {
    await recordEvent(supabaseAdmin, orderId, "rr_promotion_noop", {
      source,
      rr_status_raw: rrStatusRaw,
      state,
      reason: promote.reason ?? null,
    });
    return { ok: true, promote_state: state, fulfillment_state: "not_needed", details: promote };
  }

  // Newly promoted → audit event.
  if (state === "promoted") {
    await recordEvent(supabaseAdmin, orderId, "rr_promoted", {
      source,
      rr_status_raw: rrStatusRaw,
      sign_hash_short: signHashShort,
      payment_id: paymentId,
    });
  }

  if (!shouldGrant) {
    return {
      ok: true,
      promote_state: state,
      fulfillment_state: "not_needed",
      payment_id: paymentId,
      details: promote,
    };
  }

  // 2) Fulfil all independently sold lines through one canonical boundary.
  // It grants available products and records delayed modules as purchased.
  let grantStatus = 200;
  let grantHttpOk = true;
  let grantOk = true;
  let grantError: string | null = null;
  let grantAlreadyFulfilled = false;
  let grantBody: any = { orders: [] };
  try {
    const finalized = await finalizeComposablePurchase(supabaseAdmin, {
      primaryOrderId: orderId,
      paymentId,
      source,
    });
    grantOk = finalized.state !== "awaiting_full_payment";
    grantBody = { state: finalized.state, order_group_id: finalized.order_group_id, orders: finalized.items };
  } catch (error) {
    grantOk = false;
    grantHttpOk = false;
    grantStatus = 500;
    grantError = error instanceof Error ? error.message : String(error);
  }

  // 3) Mark fulfillment. Only 'completed' when grant is CONFIRMED by response body.
  const outcome = grantOk ? "completed" : "failed";
  const { error: markErr } = await supabaseAdmin.rpc("rr_mark_fulfillment", {
    _order_id: orderId,
    _outcome: outcome,
    _error: grantError,
    _details: {
      source,
      grant_status: grantStatus,
      grant_http_ok: grantHttpOk,
      grant_success: grantOk,
      grant_already_fulfilled: grantAlreadyFulfilled,
      grant_response_summary: {
        success: grantOk,
        order_count: grantBody.orders?.length ?? 0,
        orders: grantBody.orders,
      },
    },
  });

  if (markErr) {
    // Marker not persisted — do NOT claim completed. Force retryable state.
    await recordEvent(supabaseAdmin, orderId, "rr_fulfillment_state_persist_failed", {
      source,
      intended_outcome: outcome,
      grant_status: grantStatus,
      grant_success: grantOk,
      grant_error: grantError,
      mark_error: markErr.message,
    });
    return {
      ok: false,
      promote_state: state,
      fulfillment_state: "failed",
      grant_status: grantStatus,
      grant_error: `mark_fulfillment_failed: ${markErr.message}`,
      payment_id: paymentId,
      details: promote,
    };
  }

  await recordEvent(
    supabaseAdmin,
    orderId,
    grantOk ? "rr_fulfillment_completed" : "rr_fulfillment_failed",
    {
      source,
      grant_status: grantStatus,
      grant_http_ok: grantHttpOk,
      grant_already_fulfilled: grantAlreadyFulfilled,
      grant_error: grantError,
    },
  );

  return {
    ok: grantOk,
    promote_state: state,
    fulfillment_state: outcome === "completed" ? "completed" : "failed",
    grant_status: grantStatus,
    grant_error: grantError ?? undefined,
    payment_id: paymentId,
    details: promote,
  };
}


async function recordEvent(
  supabaseAdmin: any,
  orderId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  try {
    const eventId = `${orderId}:${eventType}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    await supabaseAdmin.from("provider_events").insert({
      provider: "rr",
      account_code: "rr",
      event_id: eventId,
      event_type: eventType,
      idempotency_key: eventId,
      payload,
      signature_valid: true,
      processing_status: "processed",
      processed_at: new Date().toISOString(),
      related_order_id: orderId,
    });
  } catch (_) {
    // non-fatal
  }
}
