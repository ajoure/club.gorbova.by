// admin-create-deal-from-payment (Stage 2R)
// - RBAC: has_admin_section_access(actor, 'payments','manage')
// - Server-computed request_hash (SHA-256 over normalized payload)
// - Atomic reservation-first RPC (see migration Stage 2R)
// - Idempotent grant invoked ALSO on replay (grant-access-for-order is itself idempotent)

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface Body {
  paymentId: string;
  rawSource: "queue" | "payments_v2";
  profileId: string;
  productId: string;
  tariffId: string;
  finalAmount: number;
  finalCurrency: string;
  accessStart: string; // ISO
  accessEnd: string;   // ISO
  customerEmail: string | null;
  grantAccess: boolean;
  idempotencyKey: string;
}

const REQUIRED = [
  "paymentId","rawSource","profileId","productId","tariffId",
  "finalAmount","finalCurrency","accessStart","accessEnd","idempotencyKey",
] as const;

function bad(status: number, error: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ok: false, error, ...extra }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function normalizeForHash(b: Body): string {
  // Стабильная сериализация: только те поля, что влияют на бизнес-содержание запроса.
  const rec = {
    paymentId: b.paymentId,
    rawSource: b.rawSource,
    profileId: b.profileId,
    productId: b.productId,
    tariffId: b.tariffId,
    finalAmount: Number(b.finalAmount).toFixed(2),
    finalCurrency: String(b.finalCurrency || "").toUpperCase(),
    accessStart: b.accessStart,
    accessEnd: b.accessEnd,
    grantAccess: !!b.grantAccess,
    customerEmail: (b.customerEmail ?? "").toLowerCase().trim(),
  };
  const keys = Object.keys(rec).sort();
  return keys.map(k => `${k}=${(rec as any)[k]}`).join("|");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return bad(405, "method_not_allowed");

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return bad(401, "unauthorized");

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authed = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1. JWT verify
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await authed.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return bad(401, "invalid_jwt");
  const actorUserId = claims.claims.sub as string;

  // 2. RBAC — section 'payments' level 'manage'
  const { data: hasAccess, error: rbacErr } = await admin.rpc("has_admin_section_access", {
    _user_id: actorUserId,
    _section_code: "payments",
    _min_level: "manage",
  });
  if (rbacErr) return bad(500, "rbac_check_failed", { detail: rbacErr.message });
  if (!hasAccess) return bad(403, "forbidden");

  // 3. Body validation
  let body: Body;
  try { body = await req.json(); } catch { return bad(400, "invalid_json"); }
  for (const k of REQUIRED) {
    const v = (body as any)[k];
    if (v === undefined || v === null || v === "") return bad(400, "missing_field", { field: k });
  }
  if (!["queue","payments_v2"].includes(body.rawSource)) return bad(400, "invalid_raw_source");
  if (typeof body.finalAmount !== "number" || !isFinite(body.finalAmount) || body.finalAmount < 0) {
    return bad(400, "invalid_amount");
  }
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const k of ["paymentId","profileId","productId","tariffId"] as const) {
    if (!uuidRe.test(String((body as any)[k]))) return bad(400, "invalid_uuid", { field: k });
  }
  if (new Date(body.accessStart).getTime() > new Date(body.accessEnd).getTime()) {
    return bad(400, "invalid_access_range");
  }

  // 4. Server-computed request_hash — покрывает всё содержание запроса
  const requestHash = await sha256Hex(normalizeForHash(body));

  // 5. Атомарный RPC
  const { data: rpc, error: rpcErr } = await admin.rpc("admin_create_deal_from_payment", {
    p_payment_id:      body.paymentId,
    p_raw_source:      body.rawSource,
    p_actor_user_id:   actorUserId,
    p_profile_id:      body.profileId,
    p_product_id:      body.productId,
    p_tariff_id:       body.tariffId,
    p_final_amount:    body.finalAmount,
    p_final_currency:  body.finalCurrency,
    p_access_start:    body.accessStart,
    p_access_end:      body.accessEnd,
    p_customer_email:  body.customerEmail,
    p_grant_access:    !!body.grantAccess,
    p_idempotency_key: body.idempotencyKey,
    p_request_hash:    requestHash,
  });

  if (rpcErr) {
    const msg = rpcErr.message || "";
    if (msg.includes("recalc_failed")) return bad(500, "recalc_failed", { detail: msg });
    return bad(500, "rpc_failed", { detail: msg });
  }
  if (!rpc || (rpc as any).ok !== true) {
    const err = (rpc as any)?.error ?? "rpc_rejected";
    const status =
      err === "idempotency_conflict"   ? 409 :
      err === "reservation_processing" ? 409 :
      err === "payment_already_linked" ? 409 :
      err === "queue_row_already_materialized" ? 409 :
      err === "payment_not_successful" ? 409 :
      err === "non_canonical_provider" ? 422 :
      err === "profile_not_found"      ? 404 :
      err === "product_invalid"        ? 422 :
      err === "tariff_invalid"         ? 422 :
      err === "ghost_cannot_grant"     ? 422 :
      err === "invalid_access_range"   ? 400 :
      err === "invalid_currency"       ? 400 :
      err === "invalid_amount"         ? 400 :
      400;
    return new Response(JSON.stringify({ ok: false, error: err, rpc }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const result = rpc as Record<string, unknown>;
  const orderId = result.order_id as string;
  const isGhost = !!result.is_ghost;
  const dealOnly = !!result.deal_only;

  // 6. Идемпотентный grant — вызываем ТАКЖЕ на replay (grant-access-for-order сам идемпотентен)
  let grantSuccess = false;
  let grantErrorCode: string | null = null;
  let subscriptionId: string | null = null;
  const shouldGrant = body.grantAccess && !isGhost && !dealOnly;
  if (shouldGrant) {
    try {
      const { data: grantResult, error: grantError } = await admin.functions.invoke(
        "grant-access-for-order",
        { body: { orderId, source: "admin_from_payment" } },
      );
      if (grantError || (grantResult as any)?.error) {
        grantErrorCode = ((grantResult as any)?.error) || grantError?.message || "unknown";
      } else {
        grantSuccess = true;
        subscriptionId = (grantResult as any)?.subscription_id ?? null;
      }
    } catch (e) {
      grantErrorCode = (e as Error).message || "exception";
    }
  }

  // 7. Audit
  try {
    await admin.from("audit_logs").insert({
      actor_user_id: actorUserId,
      action: body.grantAccess
        ? "admin.create_deal_with_access_from_payment"
        : "admin.create_deal_from_payment",
      target_user_id: isGhost ? null : null, // сервер не раскрывает user_id клиенту, пишем profile_id ниже
      meta: {
        order_id: orderId,
        order_number: result.order_number,
        payment_id: result.payment_id,
        payment_source: body.rawSource,
        provider: result.provider,
        profile_id: body.profileId,
        source_amount: result.source_amount,
        source_currency: result.source_currency,
        order_final_price: body.finalAmount,
        order_currency: body.finalCurrency,
        access_start: body.accessStart,
        access_end: body.accessEnd,
        is_ghost: isGhost,
        deal_only: dealOnly,
        idempotent_replay: !!result.idempotent_replay,
        request_hash: requestHash,
        grant_success: grantSuccess,
        grant_error_code: grantErrorCode,
        subscription_id: subscriptionId,
        recalc: result.recalc,
      },
    });
  } catch (_e) { /* audit failure not fatal */ }

  return new Response(
    JSON.stringify({
      ok: true,
      order_id: orderId,
      order_number: result.order_number,
      payment_id: result.payment_id,
      provider: result.provider,
      is_ghost: isGhost,
      deal_only: dealOnly,
      idempotent_replay: !!result.idempotent_replay,
      source_amount: result.source_amount,
      source_currency: result.source_currency,
      recalc: result.recalc,
      grant_success: grantSuccess,
      grant_error_code: grantErrorCode,
      subscription_id: subscriptionId,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
