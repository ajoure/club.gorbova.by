import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { expandWithAccessAliasOrigins } from "../_shared/access-alias-origin.ts";

type Action = "health" | "retry" | "dismiss";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function allowedOrigins() {
  return expandWithAccessAliasOrigins(
    (Deno.env.get("COMPANY_SYNC_ADMIN_ALLOWED_ORIGINS") ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function responseHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const allowed = allowedOrigins().has(origin);

  return {
    allowed,
    headers: {
      "Access-Control-Allow-Origin": allowed ? origin : "null",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
      Vary: "Origin",
    },
  };
}

function json(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Browser-facing adapter for the service-only Company sync queue RPCs.
 *
 * The queue table and RPCs remain inaccessible to anon/authenticated roles.
 * This endpoint validates both the caller JWT and the admin/super_admin role,
 * then invokes the existing RPCs with the service key and caller id for audit.
 */
Deno.serve(async (request) => {
  const cors = responseHeaders(request);

  if (request.method === "OPTIONS") {
    return cors.allowed
      ? new Response(null, { status: 204, headers: cors.headers })
      : json({ error: "origin_not_allowed" }, 403, cors.headers);
  }

  if (!cors.allowed) {
    return json({ error: "origin_not_allowed" }, 403, cors.headers);
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, cors.headers);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error("[company-sync-admin] required Supabase configuration is missing");
    return json({ error: "service_unavailable" }, 503, cors.headers);
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401, cors.headers);
  }

  try {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: auth, error: authError } = await userClient.auth.getUser();
    if (authError || !auth.user) {
      return json({ error: "unauthorized" }, 401, cors.headers);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const [adminRole, superAdminRole] = await Promise.all([
      adminClient.rpc("has_role_v2", { _user_id: auth.user.id, _role_code: "admin" }),
      adminClient.rpc("has_role_v2", { _user_id: auth.user.id, _role_code: "super_admin" }),
    ]);
    if (adminRole.error || superAdminRole.error) {
      console.error("[company-sync-admin] role check failed");
      return json({ error: "authorization_unavailable" }, 503, cors.headers);
    }
    if (!adminRole.data && !superAdminRole.data) {
      return json({ error: "forbidden" }, 403, cors.headers);
    }

    const body = await request.json() as { action?: Action; jobId?: string; reason?: string };
    if (body.action === "health") {
      const { data, error } = await adminClient.rpc("crm_company_sync_health");
      if (error) throw error;
      return json({ ok: true, health: data }, 200, cors.headers);
    }

    if (body.action !== "retry" && body.action !== "dismiss") {
      return json({ error: "invalid_action" }, 400, cors.headers);
    }
    if (!body.jobId || !UUID_RE.test(body.jobId)) {
      return json({ error: "invalid_job_id" }, 400, cors.headers);
    }
    const reason = body.reason?.trim() ?? "";
    if (reason.length < 3 || reason.length > 500) {
      return json({ error: "invalid_reason" }, 400, cors.headers);
    }

    const rpc = body.action === "retry"
      ? "crm_company_sync_admin_retry"
      : "crm_company_sync_admin_dismiss";
    const { data, error } = await adminClient.rpc(rpc, {
      _id: body.jobId,
      _actor_user_id: auth.user.id,
      _reason: reason,
    });
    if (error) throw error;

    console.info("[company-sync-admin] action=" + body.action + " actor=" + auth.user.id + " job=" + body.jobId);
    return json({ ok: true, result: data }, 200, cors.headers);
  } catch (error) {
    // Do not relay SQL details or queue payloads to the browser.
    console.error("[company-sync-admin] operation failed", error instanceof Error ? error.message.slice(0, 300) : "unknown");
    return json({ error: "operation_failed" }, 500, cors.headers);
  }
});
