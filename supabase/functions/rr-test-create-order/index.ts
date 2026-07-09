/**
 * rr-test-create-order (admin-only, test mode)
 *
 * Создаёт тестовую заявку в РР (createOrder) c synthetic external_id
 * `rr_test_<uuid>`. Сумма и валюта — параметры (по умолчанию 1000 BYN).
 * Пишет запись в rr_test_ledger. Не пишет в payments_v2/orders_v2.
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
  rrCreateOrder,
  redactRRResponse,
} from "../_shared/rr/rr-adapter.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflightRequest();
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  // Auth: admin only
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return errorResponse("unauthorized", 401);
  }
  const jwt = authHeader.slice("Bearer ".length);
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(jwt);
  if (claimsErr || !claimsData?.claims?.sub) {
    return errorResponse("unauthorized", 401);
  }
  const userId = claimsData.claims.sub as string;

  const supabaseAdmin = createServiceClient();
  const { data: roleRow } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "superadmin"])
    .maybeSingle();
  if (!roleRow) return errorResponse("forbidden_admin_only", 403);

  let payload: { amount_minor?: number; currency?: string } = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const amountMinor = Number.isFinite(payload.amount_minor) &&
      (payload.amount_minor ?? 0) > 0
    ? Math.round(payload.amount_minor as number)
    : 100000; // 1000.00 по умолчанию
  const currency = (payload.currency ?? "BYN").toUpperCase();
  if (!["BYN", "RUB"].includes(currency)) {
    return errorResponse("currency_not_supported_in_test", 400);
  }

  let cfg;
  try {
    cfg = await loadRRTestConfig(supabaseAdmin);
  } catch (e) {
    return errorResponse((e as Error).message, 400);
  }

  const externalId = `rr_test_${crypto.randomUUID()}`;
  const correlationId = crypto.randomUUID();

  const projectRef = (Deno.env.get("SUPABASE_URL") ?? "").match(
    /https:\/\/([^.]+)\.supabase\.co/,
  )?.[1];
  const notificationUrl = projectRef
    ? `https://${projectRef}.supabase.co/functions/v1/rr-notification`
    : `${Deno.env.get("SUPABASE_URL")}/functions/v1/rr-notification`;

  const created = await rrCreateOrder(cfg, {
    externalId,
    amountMinor,
    currency,
    notificationUrl,
    correlationId,
  });

  const redacted = redactRRResponse(created.http.json);

  // Insert ledger record. Пишем даже при ошибке — для аудита test-попытки.
  await supabaseAdmin.from("rr_test_ledger").insert({
    external_id: externalId,
    rr_request_id: created.rrRequestId ?? null,
    amount_minor: amountMinor,
    currency,
    status_internal: created.ok ? "created" : "failed",
    status_raw: created.rrStatusRaw ?? (created.ok ? null : "create_failed"),
    payment_url: created.paymentUrl ?? null,
    created_by: userId,
    raw_last: redacted,
  });

  await supabaseAdmin.from("integration_sync_logs").insert({
    instance_id: cfg.instanceId,
    entity_type: "rr_order",
    direction: "outbound",
    object_id: externalId,
    object_type: "rr_test_order",
    result: created.ok ? "success" : "error",
    error_message: created.ok ? null : (created.errorText ?? "create_failed"),
    payload_meta: {
      call: created.http.safeCallDescriptor,
      external_id: externalId,
      correlation_id: correlationId,
      status_raw: created.rrStatusRaw ?? null,
    },
  });

  if (!created.ok) {
    return jsonResponse({
      success: false,
      external_id: externalId,
      error: created.errorText ?? "rr_create_failed",
      http_status: created.status,
    }, 502);
  }

  return jsonResponse({
    success: true,
    external_id: externalId,
    rr_request_id: created.rrRequestId,
    payment_url: created.paymentUrl,
    status_raw: created.rrStatusRaw,
    status_internal: "created",
    amount_minor: amountMinor,
    currency: "RUB",
    note: "Тестовая заявка. Не связана с реальными заказами.",
  });
});
