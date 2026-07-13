// admin-create-deal-from-payment (Stage 2)
// JWT-auth + RBAC (admin/superadmin) + вызов атомарного SECURITY DEFINER RPC.
// Grant access — идемпотентно после commit, ошибка не откатывает платёж.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface Body {
  paymentId: string;
  rawSource: "queue" | "payments_v2";
  profileId: string;
  contactUserId: string;
  productId: string;
  tariffId: string;
  finalAmount: number;
  finalCurrency: string;
  accessStart: string; // ISO
  accessEnd: string;   // ISO
  customerEmail: string | null;
  dealOnly: boolean;
  isGhost: boolean;
  grantAccess: boolean;
  idempotencyKey: string;
}

function bad(status: number, error: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ok: false, error, ...extra }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

  // 2. RBAC — только admin/superadmin
  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", actorUserId);
  const roleSet = new Set((roles ?? []).map((r: any) => r.role));
  const isAdmin = roleSet.has("admin") || roleSet.has("superadmin");
  if (!isAdmin) return bad(403, "forbidden");

  // 3. Body validation
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return bad(400, "invalid_json");
  }
  const required = [
    "paymentId", "rawSource", "profileId", "contactUserId",
    "productId", "tariffId", "finalAmount", "finalCurrency",
    "accessStart", "accessEnd", "idempotencyKey",
  ];
  for (const k of required) {
    if ((body as any)[k] === undefined || (body as any)[k] === null || (body as any)[k] === "") {
      return bad(400, "missing_field", { field: k });
    }
  }
  if (!["queue", "payments_v2"].includes(body.rawSource)) return bad(400, "invalid_raw_source");
  if (typeof body.finalAmount !== "number" || body.finalAmount < 0) return bad(400, "invalid_amount");

  // 4. Атомарный RPC
  const { data: rpc, error: rpcErr } = await admin.rpc("admin_create_deal_from_payment", {
    p_payment_id: body.paymentId,
    p_raw_source: body.rawSource,
    p_actor_user_id: actorUserId,
    p_profile_id: body.profileId,
    p_contact_user_id: body.contactUserId,
    p_product_id: body.productId,
    p_tariff_id: body.tariffId,
    p_final_amount: body.finalAmount,
    p_final_currency: body.finalCurrency,
    p_access_start: body.accessStart,
    p_access_end: body.accessEnd,
    p_customer_email: body.customerEmail,
    p_deal_only: body.dealOnly,
    p_idempotency_key: body.idempotencyKey,
    p_is_ghost: body.isGhost,
  });

  if (rpcErr) return bad(500, "rpc_failed", { detail: rpcErr.message });
  if (!rpc || (rpc as any).ok !== true) {
    return bad(409, (rpc as any)?.error ?? "rpc_rejected", { rpc });
  }

  const result = rpc as Record<string, unknown>;
  const orderId = result.order_id as string;

  // 5. Идемпотентный grant после commit (ошибка НЕ откатывает платёж)
  let grantSuccess = false;
  let grantErrorCode: string | null = null;
  let subscriptionId: string | null = null;
  if (body.grantAccess && !body.isGhost && !result.idempotent_replay) {
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

  // 6. Audit
  try {
    await admin.from("audit_logs").insert({
      actor_user_id: actorUserId,
      action: body.grantAccess
        ? "admin.create_deal_with_access_from_payment"
        : "admin.create_deal_from_payment",
      target_user_id: body.isGhost ? null : body.contactUserId,
      meta: {
        order_id: orderId,
        order_number: result.order_number,
        payment_id: result.payment_id,
        payment_source: body.rawSource,
        provider: result.provider,
        amount: body.finalAmount,
        currency: body.finalCurrency,
        access_start: body.accessStart,
        access_end: body.accessEnd,
        is_ghost: body.isGhost,
        idempotent_replay: result.idempotent_replay ?? false,
        subscription_id: subscriptionId,
        grant_success: grantSuccess,
        grant_error_code: grantErrorCode,
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
      idempotent_replay: result.idempotent_replay ?? false,
      recalc: result.recalc,
      grant_success: grantSuccess,
      grant_error_code: grantErrorCode,
      subscription_id: subscriptionId,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
