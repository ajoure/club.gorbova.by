// admin-create-manual-payment (Stage 3R.1)
//
// Canonical manual payment writer. Пишет напрямую в public.payments_v2 через
// SECURITY DEFINER RPC public.admin_create_manual_payment_v1 (origin='manual_admin').
// Поддерживает 3 режима: (A) без контакта/сделки, (B) только контакт,
// (C) контакт + существующая сделка (атомарный lock + recalc).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  finalizeComposablePurchase,
  GrantAccessInvokeError,
} from "../_shared/finalize-composable-purchase.ts";
import { applyCrmStageOnTerminal } from "../_shared/crm-routing.ts";
import { getCallerUserId } from "../_shared/caller-user.ts";

interface Body {
  provider: "bepaid" | "stripe" | "rr" | "bank";
  amount: number;
  currency: string;
  paidAt: string; // ISO
  profileId?: string | null;
  orderId?: string | null;
  receivingBankName?: string | null;
  comment?: string | null;
  contactNameSnapshot?: string | null;
  orderNumberSnapshot?: string | null;
  idempotencyKey: string;
}

const CURRENCIES = ["BYN", "RUB", "USD", "EUR", "KZT", "UAH", "PLN"];
const PROVIDERS = ["bepaid", "stripe", "rr", "bank"];

function bad(
  status: number,
  error: string,
  extra: Record<string, unknown> = {},
) {
  return new Response(JSON.stringify({ ok: false, error, ...extra }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return bad(405, "method_not_allowed");

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return bad(401, "unauthorized");

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const actorUserId = await getCallerUserId(req, "admin-create-manual-payment");
  if (!actorUserId) return bad(401, "invalid_jwt");

  const { data: hasAccess, error: rbacErr } = await admin.rpc(
    "has_admin_resource_access",
    {
      _user_id: actorUserId,
      _section_code: "payments",
      _resource_code: "manual-payment",
      _min_level: "edit",
    },
  );
  if (rbacErr) {
    return bad(500, "rbac_check_failed", { detail: rbacErr.message });
  }
  if (!hasAccess) return bad(403, "forbidden");

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return bad(400, "invalid_json");
  }

  const provider = String(body.provider || "").toLowerCase();
  if (!PROVIDERS.includes(provider)) return bad(400, "invalid_provider");

  if (
    typeof body.amount !== "number" || !isFinite(body.amount) ||
    body.amount <= 0
  ) {
    return bad(400, "invalid_amount");
  }
  const currency = String(body.currency || "").toUpperCase();
  if (!CURRENCIES.includes(currency)) return bad(400, "invalid_currency");

  if (!body.paidAt || Number.isNaN(Date.parse(body.paidAt))) {
    return bad(400, "invalid_paid_at");
  }
  const paidAtIso = new Date(body.paidAt).toISOString();

  if (!body.idempotencyKey || body.idempotencyKey.length < 8) {
    return bad(400, "missing_idempotency_key");
  }

  const receivingBankName = provider === "bank"
    ? ((body.receivingBankName || "").trim() || null)
    : null;
  const comment = (body.comment || "").trim() || null;
  const contactNameSnapshot = (body.contactNameSnapshot || "").trim() || null;
  const orderNumberSnapshot = (body.orderNumberSnapshot || "").trim() || null;
  const profileId = body.profileId || null;
  const orderId = body.orderId || null;

  const requestId = crypto.randomUUID();

  // Стабильный нормализованный payload для request_hash.
  const normalized = JSON.stringify({
    v: 2,
    provider,
    amount: body.amount,
    currency,
    paidAt: paidAtIso,
    profileId,
    orderId,
    receivingBankName,
    comment,
  });
  const requestHash = await sha256Hex(normalized);

  const { data: rpcResult, error: rpcErr } = await admin.rpc(
    "admin_create_manual_payment_v1",
    {
      p_actor_user_id: actorUserId,
      p_provider: provider,
      p_amount: body.amount,
      p_currency: currency,
      p_paid_at: paidAtIso,
      p_profile_id: profileId,
      p_related_order_id: orderId,
      p_receiving_bank_name: receivingBankName,
      p_comment: comment,
      p_contact_name_snapshot: contactNameSnapshot,
      p_order_number_snapshot: orderNumberSnapshot,
      p_idempotency_key: body.idempotencyKey,
      p_request_hash: requestHash,
    },
  );

  if (rpcErr) {
    if (String(rpcErr.message).includes("order_already_fully_paid")) {
      return bad(409, "order_already_fully_paid", {
        request_id: requestId,
      });
    }
    return bad(500, "rpc_failed", {
      detail: rpcErr.message,
      request_id: requestId,
    });
  }
  if (!rpcResult || rpcResult.ok !== true) {
    const err = String(rpcResult?.error || "rpc_error");
    const status = err === "idempotency_conflict"
      ? 409
      : err === "order_profile_conflict" || err === "order_currency_conflict"
        || err === "order_already_fully_paid"
      ? 409
      : err === "profile_not_found" || err === "order_not_found"
      ? 404
      : [
          "invalid_provider",
          "invalid_amount",
          "invalid_currency",
          "invalid_paid_at",
          "invalid_request_hash",
          "missing_idempotency_key",
          "missing_receiving_bank_name",
          "receiving_bank_name_too_long",
        ].includes(err)
      ? 400
      : 500;
    return bad(status, err, { detail: rpcResult, request_id: requestId });
  }

  // Audit
  const { error: auditErr } = await admin.from("audit_logs").insert({
    actor_user_id: actorUserId,
    action: "admin_manual_payment_created",
    entity_type: "payments_v2",
    entity_id: String(rpcResult.payment_id),
    meta: {
      request_id: requestId,
      payment_id: rpcResult.payment_id,
      provider,
      origin: "manual_admin",
      idempotency_key: body.idempotencyKey,
      request_hash: requestHash,
      amount: body.amount,
      currency,
      paid_at: paidAtIso,
      profile_id: rpcResult.profile_id ?? profileId,
      order_id: rpcResult.order_id ?? orderId,
      receiving_bank_name: receivingBankName,
      comment,
      idempotent_replay: rpcResult.idempotent_replay === true,
      recalc: rpcResult.recalc ?? null,
    },
  });
  if (auditErr) {
    console.error(
      "[admin-create-manual-payment] audit insert failed",
      auditErr,
    );
  }

  // A manual payment linked to an order must enter the exact same fulfilment
  // boundary as provider webhooks. The RPC above is the payment writer only;
  // it intentionally does not grant product access or send notifications.
  // Re-read the recalculated order state and finalize only when it is fully paid.
  // finalizeComposablePurchase and grant-access-for-order are idempotent, so an
  // idempotency replay safely repairs a previously interrupted downstream chain.
  let fulfillment: Record<string, unknown> = { state: "not_applicable" };
  let crmStage: Record<string, unknown> = {
    applied: false,
    reason: "not_applicable",
  };
  let downstreamComplete = true;
  let downstreamRetryable = false;
  const resolvedOrderId = (rpcResult.order_id ?? orderId) as string | null;
  if (resolvedOrderId) {
    const { data: orderAfterPayment, error: orderLookupErr } = await admin
      .from("orders_v2")
      .select("id,status")
      .eq("id", resolvedOrderId)
      .maybeSingle();
    if (orderLookupErr) {
      fulfillment = {
        state: "failed",
        error_code: "manual_payment_order_reload_failed",
      };
      downstreamComplete = false;
      downstreamRetryable = true;
    }

    if (!orderLookupErr && orderAfterPayment?.status === "paid") {
      try {
        fulfillment = await finalizeComposablePurchase(admin, {
          primaryOrderId: resolvedOrderId,
          paymentId: String(rpcResult.payment_id),
          source: "admin-create-manual-payment",
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
          action: "admin_manual_payment_fulfillment_failed",
          entity_type: "orders_v2",
          entity_id: resolvedOrderId,
          meta: {
            request_id: requestId,
            payment_id: rpcResult.payment_id,
            detail,
            ...grantFailure,
          },
        });
        fulfillment = {
          state: "failed",
          error_code: "manual_payment_fulfillment_failed",
          ...grantFailure,
        };
        downstreamComplete = false;
        downstreamRetryable = true;
      }

      if (downstreamComplete) {
        crmStage = await applyCrmStageOnTerminal(
          admin,
          resolvedOrderId,
          "success",
          "admin_manual_payment_paid",
        );
        const stageReason = String(crmStage.reason ?? "");
        if (!crmStage.applied && stageReason !== "idempotent") {
          downstreamComplete = false;
          await admin.from("audit_logs").insert({
            actor_user_id: actorUserId,
            action: "admin_manual_payment_crm_stage_incomplete",
            entity_type: "orders_v2",
            entity_id: resolvedOrderId,
            meta: {
              request_id: requestId,
              payment_id: rpcResult.payment_id,
              crm_stage: crmStage,
            },
          });
        }
      }
    } else if (!orderLookupErr) {
      fulfillment = {
        state: "awaiting_full_payment",
        order_status: orderAfterPayment?.status ?? null,
      };
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      payment_written: true,
      request_id: requestId,
      idempotent_replay: rpcResult.idempotent_replay === true,
      payment_id: rpcResult.payment_id,
      provider,
      amount: rpcResult.amount,
      currency: rpcResult.currency,
      paid_at: rpcResult.paid_at,
      order_id: rpcResult.order_id ?? orderId,
      profile_id: rpcResult.profile_id ?? profileId,
      origin: "manual_admin",
      fulfillment,
      crm_stage: crmStage,
      downstream_complete: downstreamComplete,
      downstream_retryable: downstreamRetryable,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
