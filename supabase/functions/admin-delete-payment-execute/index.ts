// admin-delete-payment-execute (Stage 4)
// Consumes a preview operation via SECURITY DEFINER RPC admin_payment_delete_execute_v1.
// Atomic single transaction; batch rollback on any failure.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface Body {
  operationId: string;
  checksum: string;
  version: number;
  reason?: string | null;
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
  if (!body.operationId || typeof body.operationId !== "string") return bad(400, "operation_id_required");
  if (!body.checksum || typeof body.checksum !== "string") return bad(400, "checksum_required");
  if (typeof body.version !== "number") return bad(400, "version_required");

  const { data: rpcResult, error: rpcErr } = await admin.rpc("admin_payment_delete_execute_v1", {
    p_actor_user_id: actorUserId,
    p_operation_id: body.operationId,
    p_checksum: body.checksum,
    p_version: body.version,
    p_reason: body.reason ?? null,
  });
  if (rpcErr) return bad(500, "rpc_failed", { detail: rpcErr.message });
  if (!rpcResult?.ok) {
    const err = String(rpcResult?.error || "rpc_error");
    const status =
      err === "operation_not_found" ? 404 :
      err === "operation_actor_mismatch" ? 403 :
      err === "operation_not_pending" || err === "already_deleted" ? 409 :
      err === "operation_expired" ? 410 :
      err === "version_mismatch" || err === "checksum_mismatch" ? 409 :
      500;
    return bad(status, err, { detail: rpcResult });
  }

  return new Response(JSON.stringify(rpcResult), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
