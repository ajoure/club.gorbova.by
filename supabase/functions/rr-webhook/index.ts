/**
 * rr-webhook (Sprint B — inert receiver)
 *
 * Sprint B принимает нотификации от РР для заказов rr_installment, но:
 *  - НЕ обновляет orders_v2.status;
 *  - НЕ пишет payments_v2;
 *  - НЕ вызывает grant-access-for-order;
 *  - НЕ трогает CRM/notifications.
 *
 * Делает ровно:
 *  1) verify signature;
 *  2) provider_events (idempotency key = externalId + newStatus + sign);
 *  3) orders_v2.meta.rr.last_notification (безопасное append);
 *  4) 200 OK.
 *
 * Sprint C расширит эту функцию: mapStatus → orders_v2.status → grant-access.
 * Callback URL, зарегистрированный в РР, менять не потребуется.
 */
import {
  handleCorsPreflightRequest,
  jsonResponse,
  errorResponse,
} from "../_shared/cors.ts";
import {
  createServiceClient,
  loadRRConfig,
} from "../_shared/rr/rr-config.ts";
import { verifyNotificationSignature } from "../_shared/rr/rr-adapter.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflightRequest();
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  let payload: {
    id?: string;
    type?: string;
    newStatus?: string;
    salt?: string;
    sign?: string;
  } = {};
  try {
    payload = await req.json();
  } catch {
    return errorResponse("invalid_json", 400);
  }

  const externalId = String(payload.id ?? "").trim();
  const newStatus = String(payload.newStatus ?? "").trim();
  const salt = String(payload.salt ?? "").trim();
  const sign = String(payload.sign ?? "").trim();
  const eventType = String(payload.type ?? "").trim();

  const supabaseAdmin = createServiceClient();

  let cfg;
  try {
    cfg = await loadRRConfig(supabaseAdmin);
  } catch (e) {
    return errorResponse((e as Error).message, 503);
  }

  // Sprint B принимает только rr_installment (external_id = orders_v2.id UUID).
  // Test-ledger идентификаторы rr_test_* маршрутизируются в rr-notification.
  if (!UUID_RE.test(externalId)) {
    return jsonResponse({ success: true, ignored: "non_uuid_external_id" });
  }

  const verify = await verifyNotificationSignature({
    newStatus,
    salt,
    sign,
    secretKey: cfg.secretKey,
  });
  if (!verify.valid) {
    await supabaseAdmin.from("provider_events").insert({
      provider: "rr",
      event_id: `${externalId}:webhook_bad_sig:${sign.slice(0, 12)}`,
      event_type: "webhook_bad_signature",
      idempotency_key: `${externalId}:${newStatus}:${sign}:bad`,
      payload: {
        event_type: eventType,
        expected_short: verify.expectedShort,
        provided_short: verify.providedShort,
      },
      signature_valid: false,
      processing_status: "rejected",
      processing_error: "invalid_signature",
      related_order_id: externalId,
    });
    return errorResponse("invalid_signature", 401);
  }

  // Ищем заказ; если не rr_installment — просто ack.
  const { data: order } = await supabaseAdmin
    .from("orders_v2")
    .select("id, meta, status")
    .eq("id", externalId)
    .maybeSingle();

  if (!order) {
    return jsonResponse({ success: true, ignored: "unknown_order" });
  }
  const meta = (order.meta ?? {}) as any;
  if (meta?.flow !== "rr_installment") {
    return jsonResponse({ success: true, ignored: "not_rr_installment_flow" });
  }

  // Идемпотентность: (external_id + newStatus + sign) — уникальный ключ.
  const idempotencyKey = `${externalId}:${newStatus}:${sign}`;
  const { data: dup } = await supabaseAdmin
    .from("provider_events")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (dup) {
    return jsonResponse({ success: true, duplicate: true });
  }

  // Append last notification в meta.rr.last_notification (без смены status).
  const nowIso = new Date().toISOString();
  const rrMeta = { ...(meta.rr ?? {}) };
  rrMeta.last_notification = {
    at: nowIso,
    event_type: eventType || null,
    new_status_raw: newStatus,
  };
  await supabaseAdmin
    .from("orders_v2")
    .update({ meta: { ...meta, rr: rrMeta } })
    .eq("id", externalId);

  await supabaseAdmin.from("provider_events").insert({
    provider: "rr",
    event_id: `${externalId}:notify:${newStatus}:${sign.slice(0, 12)}`,
    event_type: "webhook_notification_received",
    idempotency_key: idempotencyKey,
    payload: {
      event_type: eventType,
      new_status_raw: newStatus,
      sprint: "B",
      side_effects: {
        status_updated: false,
        payment_created: false,
        access_granted: false,
        crm_pushed: false,
      },
    },
    signature_valid: true,
    processing_status: "acknowledged",
    processed_at: nowIso,
    related_order_id: externalId,
  });

  return jsonResponse({ success: true });
});
