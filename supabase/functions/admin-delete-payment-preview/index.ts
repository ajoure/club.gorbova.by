// admin-delete-payment-preview (Stage 4)
// Preview payment delete. Two modes: payment_only | order_with_all_linked_payments.
// Wraps SECURITY DEFINER RPC public.admin_payment_delete_preview_v1.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface Body {
  mode: "payment_only" | "order_with_all_linked_payments";
  paymentIds?: string[];
  orderId?: string | null;
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

  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await authed.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return bad(401, "invalid_jwt");
  const actorUserId = claims.claims.sub as string;

  const { data: hasAccess, error: rbacErr } = await admin.rpc("has_admin_section_access", {
    _user_id: actorUserId,
    _section_code: "payments",
    _min_level: "manage",
  });
  if (rbacErr) return bad(500, "rbac_check_failed", { detail: rbacErr.message });
  if (!hasAccess) return bad(403, "forbidden");

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return bad(400, "invalid_json");
  }

  if (body.mode !== "payment_only" && body.mode !== "order_with_all_linked_payments") {
    return bad(400, "invalid_mode");
  }
  const paymentIds = Array.isArray(body.paymentIds)
    ? body.paymentIds.filter((s) => typeof s === "string" && s.length > 0)
    : [];
  const orderId = body.orderId || null;

  if (body.mode === "payment_only" && paymentIds.length === 0) {
    return bad(400, "payment_ids_required");
  }
  if (body.mode === "order_with_all_linked_payments" && !orderId) {
    return bad(400, "order_id_required");
  }

  const { data: rpcResult, error: rpcErr } = await admin.rpc("admin_payment_delete_preview_v1", {
    p_actor_user_id: actorUserId,
    p_mode: body.mode,
    p_payment_ids: paymentIds,
    p_order_id: orderId,
  });
  if (rpcErr) return bad(500, "rpc_failed", { detail: rpcErr.message });
  if (!rpcResult?.ok) {
    const err = String(rpcResult?.error || "rpc_error");
    const status =
      err === "invalid_mode" || err === "order_id_required" || err === "payment_ids_required" ? 400 :
      err === "no_payments_for_order" || err === "some_payments_missing_or_deleted" ? 409 :
      500;
    return bad(status, err, { detail: rpcResult });
  }

  return new Response(JSON.stringify(rpcResult), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
