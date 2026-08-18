// admin-retry-manual-payment-downstream
//
// Continues fulfilment for an existing succeeded manual payment. This endpoint
// intentionally has no payment-writer dependency: a retry cannot insert a
// second payments_v2 row even when the browser remounts or generates a new key.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  finalizeComposablePurchase,
  GrantAccessInvokeError,
} from "../_shared/finalize-composable-purchase.ts";
import { applyCrmStageOnTerminal } from "../_shared/crm-routing.ts";
import { getCallerUserId } from "../_shared/caller-user.ts";

interface Body {
  paymentId?: string;
}

function json(
  status: number,
  body: Record<string, unknown>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const actorUserId = await getCallerUserId(
    req,
    "admin-retry-manual-payment-downstream",
  );
  if (!actorUserId) {
    return json(401, { ok: false, error: "invalid_jwt" });
  }

  const { data: hasAccess, error: rbacError } = await admin.rpc(
    "has_admin_resource_access",
    {
      _user_id: actorUserId,
      _section_code: "payments",
      _resource_code: "manual-payment",
      _min_level: "edit",
    },
  );
  if (rbacError) {
    return json(500, {
      ok: false,
      error: "rbac_check_failed",
      detail: rbacError.message,
    });
  }
  if (!hasAccess) return json(403, { ok: false, error: "forbidden" });

  const body = await req.json().catch(() => null) as Body | null;
  const paymentId = body?.paymentId?.trim();
  if (!paymentId) {
    return json(400, { ok: false, error: "missing_payment_id" });
  }

  const { data: payment, error: paymentError } = await admin
    .from("payments_v2")
    .select("id,order_id,status,origin,is_deleted")
    .eq("id", paymentId)
    .maybeSingle();
  if (paymentError) {
    return json(500, {
      ok: false,
      error: "payment_lookup_failed",
      detail: paymentError.message,
    });
  }
  if (!payment || payment.is_deleted) {
    return json(404, { ok: false, error: "payment_not_found" });
  }
  if (payment.origin !== "manual_admin") {
    return json(409, { ok: false, error: "not_manual_admin_payment" });
  }
  if (payment.status !== "succeeded") {
    return json(409, { ok: false, error: "payment_not_succeeded" });
  }
  if (!payment.order_id) {
    return json(409, { ok: false, error: "payment_has_no_order" });
  }

  const { data: order, error: orderError } = await admin
    .from("orders_v2")
    .select("id,status")
    .eq("id", payment.order_id)
    .maybeSingle();
  if (orderError) {
    return json(500, {
      ok: false,
      error: "order_lookup_failed",
      detail: orderError.message,
    });
  }
  if (!order) return json(404, { ok: false, error: "order_not_found" });
  if (order.status !== "paid") {
    return json(409, {
      ok: false,
      error: "order_not_paid",
      order_status: order.status,
    });
  }

  const requestId = crypto.randomUUID();
  let fulfillment: Record<string, unknown>;
  try {
    fulfillment = await finalizeComposablePurchase(admin, {
      primaryOrderId: order.id,
      paymentId: payment.id,
      source: "admin-retry-manual-payment-downstream",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const grantFailure = error instanceof GrantAccessInvokeError
      ? {
        downstream_step: "grant-access-for-order",
        grant_status: error.status,
        grant_code: error.code,
      }
      : {};
    await admin.from("audit_logs").insert({
      actor_user_id: actorUserId,
      action: "admin_manual_payment_downstream_retry_failed",
      entity_type: "orders_v2",
      entity_id: order.id,
      meta: {
        request_id: requestId,
        payment_id: payment.id,
        detail,
        ...grantFailure,
      },
    });
    return json(200, {
      ok: true,
      payment_written: false,
      payment_id: payment.id,
      downstream_complete: false,
      downstream_retryable: true,
      fulfillment: {
        state: "failed",
        error_code: "manual_payment_fulfillment_failed",
        ...grantFailure,
      },
    });
  }

  const crmStage = await applyCrmStageOnTerminal(
    admin,
    order.id,
    "success",
    "admin_manual_payment_paid",
  );
  const stageReason = String(crmStage.reason ?? "");
  const downstreamComplete = crmStage.applied === true || stageReason === "idempotent";
  if (!downstreamComplete) {
    await admin.from("audit_logs").insert({
      actor_user_id: actorUserId,
      action: "admin_manual_payment_downstream_retry_crm_stage_incomplete",
      entity_type: "orders_v2",
      entity_id: order.id,
      meta: {
        request_id: requestId,
        payment_id: payment.id,
        crm_stage: crmStage,
      },
    });
  }

  return json(200, {
    ok: true,
    payment_written: false,
    payment_id: payment.id,
    fulfillment,
    crm_stage: crmStage,
    downstream_complete: downstreamComplete,
    downstream_retryable: !downstreamComplete,
  });
});
