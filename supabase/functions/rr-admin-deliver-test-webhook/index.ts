/**
 * rr-admin-deliver-test-webhook (admin-only, test-mode only)
 *
 * Назначение (Sprint C1 verification):
 *   Позволяет админу доставить в production `rr-webhook` подписанный
 *   webhook для реального orders_v2 (provider='rr', meta.flow='rr_installment')
 *   строго в тестовой конфигурации RR-интеграции. Используется для
 *   контролируемого signed-webhook E2E прогона, эквивалентного реальному
 *   webhook от сервера РР (secret_key/подпись — те же).
 *
 * Жёсткие guards (любой fail → отказ):
 *   1. verify_jwt=true (declared in config.toml).
 *   2. auth: JWT валиден, user_roles ∈ {admin, superadmin}.
 *   3. RR-интеграция в mode='test' (loadRRTestConfig бросает иначе).
 *   4. order_id — валидный uuid, существует в orders_v2.
 *   5. orders_v2.provider = 'rr' AND meta.flow = 'rr_installment'.
 *   6. Для основной доставки: orders_v2.status = 'pending'
 *      (первичное продвижение). Для bad_signature-проверки допустим любой
 *      статус — эффект всё равно должен быть 401 без изменений.
 *   7. newStatus захардкожен как 'authorized'. Свободного выбора нет.
 *   8. Подпись считается на backend из test secret_key; сам ключ никогда
 *      не возвращается и не логируется.
 *   9. Ответ содержит только короткий hash подписи (первые 16 байт SHA-256).
 *  10. Audit: строка в integration_sync_logs с actor, order_id, mode=test,
 *      synthetic_delivery=true.
 *
 * НЕ ДЕЛАЕТ:
 *   - Не создаёт orders_v2, payments_v2, entitlements, ledger.
 *   - Не пишет в rr_test_ledger (это отдельный тестовый стенд).
 *   - Не принимает произвольный status/payload.
 *   - Не работает в mode='battle'.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  handleCorsPreflightRequest,
  jsonResponse,
  errorResponse,
} from "../_shared/cors.ts";
import {
  createServiceClient,
  loadRRTestConfig,
} from "../_shared/rr/rr-config.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function md5Hex(input: string): Promise<string> {
  const mod = await import("npm:blueimp-md5@2.19.0");
  const md5 = (mod.default ?? mod) as (s: string) => string;
  return md5(input);
}

async function sha256Short(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflightRequest();
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  // --- Guard 1: auth (admin/superadmin) ---
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

  // --- Payload ---
  let payload: {
    order_id?: string;
    bad_signature?: boolean;
    event_type?: string;
  } = {};
  try { payload = await req.json(); } catch { payload = {}; }

  const orderId = String(payload.order_id ?? "").trim();
  const badSignature = payload.bad_signature === true;
  const eventType = String(payload.event_type ?? "order.updated").trim();
  const newStatus = "authorized"; // жёстко зафиксирован

  if (!UUID_RE.test(orderId)) return errorResponse("order_id_invalid_uuid", 400);

  // --- Guard 2: mode='test' ---
  let cfg;
  try {
    cfg = await loadRRTestConfig(supabaseAdmin);
  } catch (e) {
    // rr_core_only_test_mode_allowed / rr_test_credentials_incomplete
    return errorResponse((e as Error).message, 403);
  }

  // --- Guard 3: order lookup + shape ---
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders_v2")
    .select("id, status, provider, meta")
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr) return errorResponse(`order_lookup_failed:${orderErr.message}`, 500);
  if (!order) return errorResponse("order_not_found", 404);
  if (order.provider !== "rr") return errorResponse("order_not_rr_provider", 400);
  const meta = (order.meta ?? {}) as any;
  if (meta?.flow !== "rr_installment") {
    return errorResponse("order_not_rr_installment_flow", 400);
  }
  if (!badSignature && order.status !== "pending") {
    return errorResponse(`order_not_pending_status_${order.status}`, 409);
  }

  // --- Compute signature ---
  const salt = crypto.randomUUID().replace(/-/g, "");
  const validSign = await md5Hex(`${newStatus}_${cfg.secretKey}_${salt}`);
  const sign = badSignature
    ? (validSign.slice(0, -1) + (validSign.endsWith("0") ? "1" : "0"))
    : validSign;
  const signHashShort = await sha256Short(sign);

  const body = {
    id: orderId,
    type: eventType,
    newStatus,
    salt,
    sign,
  };

  // --- Deliver to production rr-webhook ---
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const url = `${supabaseUrl}/functions/v1/rr-webhook`;

  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const respText = await res.text();
  let respJson: unknown = null;
  try { respJson = JSON.parse(respText); } catch { respJson = null; }
  const durationMs = Date.now() - started;

  // --- Audit ---
  await supabaseAdmin.from("integration_sync_logs").insert({
    instance_id: cfg.instanceId,
    entity_type: "rr_admin_synthetic_webhook",
    direction: "outbound",
    object_id: orderId,
    object_type: "rr_admin_deliver_test_webhook",
    result: res.ok ? "success" : "error",
    error_message: res.ok ? null : `http_${res.status}`,
    payload_meta: {
      actor_user_id: userId,
      mode: "test",
      synthetic_delivery: true,
      bad_signature: badSignature,
      new_status: newStatus,
      event_type: eventType,
      sign_hash_short: signHashShort,
      http_status: res.status,
      duration_ms: durationMs,
    },
  });

  return jsonResponse({
    success: true,
    order_id: orderId,
    mode: "test",
    synthetic_delivery: true,
    bad_signature: badSignature,
    new_status: newStatus,
    sign_hash_short: signHashShort,
    webhook_response: {
      http_status: res.status,
      duration_ms: durationMs,
      body: respJson ?? { text_short: respText.slice(0, 200) },
    },
  });
});
