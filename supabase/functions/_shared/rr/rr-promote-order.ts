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
  const { supabaseAdmin, supabaseUrl, serviceRoleKey } = deps;
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

  if (paymentId) {
    const { data: settled, error: settleError } = await supabaseAdmin.rpc(
      "settle_composable_order_group",
      { _primary_order_id: orderId, _payment_id: paymentId },
    );
    if (settleError || settled?.ok === false) {
      const error = settleError?.message ?? String(settled?.error ?? "not_confirmed");
      await recordEvent(supabaseAdmin, orderId, "rr_group_settlement_failed", {
        source, payment_id: paymentId, error,
      });
      return {
        ok: false, promote_state: state, fulfillment_state: "failed",
        grant_error: `group_settlement_failed: ${error}`,
        payment_id: paymentId, details: promote,
      };
    }
  }

  const { data: groupRows, error: groupRowsError } = await supabaseAdmin
    .from("order_group_items")
    .select("order_id,sort_order,order_group:order_groups!inner(primary_order_id)")
    .eq("order_group.primary_order_id", orderId)
    .not("order_id", "is", null)
    .order("sort_order");
  if (groupRowsError) {
    return {
      ok: false, promote_state: state, fulfillment_state: "failed",
      grant_error: `group_items_lookup_failed: ${groupRowsError.message}`,
      payment_id: paymentId, details: promote,
    };
  }
  const grantOrderIds = groupRows?.length
    ? groupRows.map((row: any) => String(row.order_id))
    : [orderId];

  // 2) Grant each product independently. Reconciler retries idempotently.
  const grantUrl = `${supabaseUrl}/functions/v1/grant-access-for-order`;

  let grantStatus = 0;
  let grantHttpOk = true;
  let grantOk = true;
  let grantError: string | null = null;
  const grantBody: any = { orders: [] };
  let grantAlreadyFulfilled = true;

  for (const grantOrderId of grantOrderIds) {
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), 20_000);
    try {
      const resp = await fetch(grantUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
          "apikey": serviceRoleKey,
        },
        body: JSON.stringify({ orderId: grantOrderId, source }),
        signal: ac.signal,
      });
      const responseBody = await resp.json().catch(() => null);
      const orderOk = resp.ok && responseBody?.success === true;
      grantStatus = orderOk ? (grantStatus || resp.status) : resp.status;
      grantHttpOk = grantHttpOk && resp.ok;
      grantOk = grantOk && orderOk;
      grantAlreadyFulfilled = grantAlreadyFulfilled &&
        responseBody?.already_fulfilled === true;
      grantBody.orders.push({
        order_id: grantOrderId, status: resp.status, success: orderOk,
        already_fulfilled: responseBody?.already_fulfilled === true,
      });
      if (!orderOk && !grantError) {
        grantError = `order_${grantOrderId}:${
          responseBody ? JSON.stringify(responseBody).slice(0, 300) : `http_${resp.status}`
        }`;
      }
    } catch (e) {
      grantOk = false;
      grantHttpOk = false;
      grantStatus = 0;
      grantError ||= `order_${grantOrderId}:${(e as Error).message}`;
    } finally {
      clearTimeout(timeoutId);
    }
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
        order_count: grantOrderIds.length,
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
