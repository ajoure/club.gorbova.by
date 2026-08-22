import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authorization = req.headers.get("Authorization") ?? "";
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const serviceCaller = authorization === `Bearer ${serviceRoleKey}`;
  let actorUserId: string | null = null;
  if (!serviceCaller) {
    if (!authorization.startsWith("Bearer ")) {
      return respond(401, { error: "unauthorized" });
    }
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authorization.slice("Bearer ".length);
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return respond(401, { error: "unauthorized" });
    actorUserId = authData.user.id;
    const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
      admin.rpc("has_role_v2", { _user_id: actorUserId, _role_code: "admin" }),
      admin.rpc("has_role_v2", { _user_id: actorUserId, _role_code: "super_admin" }),
    ]);
    if (!isAdmin && !isSuperAdmin) return respond(403, { error: "forbidden" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    return respond(400, { error: "invalid_json" });
  }
  const scheduledAccessId = body.scheduled_access_id == null
    ? null
    : String(body.scheduled_access_id);
  if (scheduledAccessId && !UUID_RE.test(scheduledAccessId)) {
    return respond(400, { error: "scheduled_access_id_invalid" });
  }
  if (!scheduledAccessId && !serviceCaller) {
    return respond(400, { error: "scheduled_access_id_required_for_manual_open" });
  }
  const limit = Math.min(100, Math.max(1, Number(body.limit ?? 25)));

  let query = admin
    .from("scheduled_product_access")
    .select(
      "id,order_id,access_delivery_mode,opens_at,access_duration_days,status,activation_attempts",
    );
  if (scheduledAccessId) {
    query = query.eq("id", scheduledAccessId).in("status", ["scheduled", "failed"]);
  } else {
    query = query
      .eq("status", "scheduled")
      .not("opens_at", "is", null)
      .lte("opens_at", new Date().toISOString())
      .order("opens_at")
      .limit(limit);
  }
  const { data: candidates, error: candidatesError } = await query;
  if (candidatesError) {
    return respond(500, { error: "scheduled_access_lookup_failed", detail: candidatesError.message });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const candidate of candidates ?? []) {
    const { data: claimed, error: claimError } = await admin
      .from("scheduled_product_access")
      .update({
        status: "activating",
        activation_attempts: Number(candidate.activation_attempts ?? 0) + 1,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", candidate.id)
      .in("status", ["scheduled", "failed"])
      .select("id")
      .maybeSingle();
    if (claimError || !claimed) {
      results.push({ id: candidate.id, state: "skipped_claimed_elsewhere" });
      continue;
    }

    const grantBody: Record<string, unknown> = {
      orderId: candidate.order_id,
      customAccessStartAt: new Date().toISOString(),
      extendFromCurrent: true,
      source: scheduledAccessId ? "scheduled_module_manual_open" : "scheduled_module_fixed_date",
    };
    if (candidate.access_duration_days) {
      grantBody.customAccessDays = candidate.access_duration_days;
    }
    const { data: grantData, error: grantError } = await admin.functions.invoke(
      "grant-access-for-order",
      { body: grantBody },
    );
    const noUser = grantData?.warning === "no_user_id";
    const failed = !!grantError || grantData?.success === false ||
      !!grantData?.error || noUser;
    if (failed) {
      const detail = grantError?.message ?? grantData?.error ??
        grantData?.warning ?? "grant_failed";
      await admin.from("scheduled_product_access").update({
        status: noUser ? "scheduled" : "failed",
        last_error: String(detail).slice(0, 1000),
        grant_result: grantData ?? null,
        updated_at: new Date().toISOString(),
      }).eq("id", candidate.id);
      results.push({ id: candidate.id, state: noUser ? "awaiting_user" : "failed", detail });
      continue;
    }

    const activatedAt = new Date().toISOString();
    const { error: completeError } = await admin
      .from("scheduled_product_access")
      .update({
        status: "activated",
        activated_at: activatedAt,
        activated_by: actorUserId,
        last_error: null,
        grant_result: grantData ?? {},
        updated_at: activatedAt,
      })
      .eq("id", candidate.id)
      .eq("status", "activating");
    if (completeError) {
      results.push({ id: candidate.id, state: "grant_succeeded_state_update_failed" });
    } else {
      results.push({ id: candidate.id, state: "activated", activated_at: activatedAt });
    }
  }

  return respond(200, { ok: true, processed: results.length, results });
});
