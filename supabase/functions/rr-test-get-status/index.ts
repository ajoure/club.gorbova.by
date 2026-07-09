/**
 * rr-test-get-status (admin-only)
 *
 * Запрашивает getOrderStatus для существующей записи rr_test_ledger,
 * обновляет status_internal/status_raw/commission_minor.
 * Не трогает payments_v2/orders_v2.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  handleCorsPreflightRequest,
  jsonResponse,
  errorResponse,
} from "../_shared/cors.ts";
import {
  createServiceClient,
  loadRRTestConfig,
} from "../_shared/rr/rr-config.ts";
import {
  mapStatus,
  redactRRResponse,
  rrGetOrderStatus,
} from "../_shared/rr/rr-adapter.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflightRequest();
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return errorResponse("unauthorized", 401);
  const jwt = authHeader.slice("Bearer ".length);
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(jwt);
  if (claimsErr || !claimsData?.claims?.sub) return errorResponse("unauthorized", 401);
  const userId = claimsData.claims.sub as string;

  const supabaseAdmin = createServiceClient();
  const { data: roleRow } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "superadmin"])
    .maybeSingle();
  if (!roleRow) return errorResponse("forbidden_admin_only", 403);

  let payload: { external_id?: string } = {};
  try {
    payload = await req.json();
  } catch { payload = {}; }
  const externalId = String(payload.external_id ?? "").trim();
  if (!externalId.startsWith("rr_test_")) {
    return errorResponse("external_id_must_be_test", 400);
  }

  // Проверяем что запись существует
  const { data: ledger } = await supabaseAdmin
    .from("rr_test_ledger")
    .select("id, external_id")
    .eq("external_id", externalId)
    .maybeSingle();
  if (!ledger) return errorResponse("ledger_row_not_found", 404);

  let cfg;
  try { cfg = await loadRRTestConfig(supabaseAdmin); }
  catch (e) { return errorResponse((e as Error).message, 400); }

  const res = await rrGetOrderStatus(cfg, externalId);
  const redacted = redactRRResponse(res.http.json);

  if (res.ok && res.rrStatusRaw) {
    await supabaseAdmin
      .from("rr_test_ledger")
      .update({
        status_raw: res.rrStatusRaw,
        status_internal: mapStatus(res.rrStatusRaw),
        commission_minor: res.commissionMinor ?? null,
        raw_last: redacted,
      })
      .eq("id", ledger.id);
  }

  await supabaseAdmin.from("integration_sync_logs").insert({
    instance_id: cfg.instanceId,
    entity_type: "rr_order",
    direction: "outbound",
    object_id: externalId,
    object_type: "rr_test_order_status",
    result: res.ok ? "success" : "error",
    error_message: res.ok ? null : (res.errorText ?? "status_failed"),
    payload_meta: {
      call: res.http.safeCallDescriptor,
      external_id: externalId,
      status_raw: res.rrStatusRaw ?? null,
    },
  });

  if (!res.ok) {
    return jsonResponse({
      success: false,
      external_id: externalId,
      error: res.errorText ?? "rr_status_failed",
      http_status: res.status,
    }, 502);
  }

  return jsonResponse({
    success: true,
    external_id: externalId,
    status_raw: res.rrStatusRaw,
    status_internal: mapStatus(res.rrStatusRaw ?? ""),
    commission_minor: res.commissionMinor ?? null,
  });
});
