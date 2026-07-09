/**
 * rr-notification (public webhook, test-ledger only)
 *
 * ЖЁСТКИЕ ОГРАНИЧЕНИЯ ЭТОГО ЭТАПА:
 *  - Принимаем только payload с external_id, начинающимся на `rr_test_`.
 *  - Обновляем ТОЛЬКО существующие записи rr_test_ledger.
 *  - НЕ создаём платежи/заказы/domain_events.
 *  - При невалидной подписи — 401, ledger не трогаем.
 *  - Идемпотентно по (external_id + newStatus + sign).
 */
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
  verifyNotificationSignature,
} from "../_shared/rr/rr-adapter.ts";

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
  try { payload = await req.json(); }
  catch { return errorResponse("invalid_json", 400); }

  const externalId = String(payload.id ?? "").trim();
  const newStatus = String(payload.newStatus ?? "").trim();
  const salt = String(payload.salt ?? "").trim();
  const sign = String(payload.sign ?? "").trim();
  const eventType = String(payload.type ?? "").trim();

  const supabaseAdmin = createServiceClient();

  let cfg;
  try { cfg = await loadRRTestConfig(supabaseAdmin); }
  catch (e) { return errorResponse((e as Error).message, 503); }

  // Guard 1: только тестовые external_id
  if (!externalId.startsWith("rr_test_")) {
    await supabaseAdmin.from("integration_sync_logs").insert({
      instance_id: cfg.instanceId,
      entity_type: "rr_notification",
      direction: "inbound",
      object_id: externalId || null,
      object_type: "rr_notification_rejected",
      result: "error",
      error_message: "non_test_external_id_rejected",
      payload_meta: { event_type: eventType, new_status_short: newStatus.slice(0, 32) },
    });
    return errorResponse("non_test_external_id_not_accepted_at_this_stage", 400);
  }

  // Guard 2: проверка подписи
  const verify = await verifyNotificationSignature({
    newStatus, salt, sign, secretKey: cfg.secretKey,
  });
  if (!verify.valid) {
    await supabaseAdmin.from("integration_sync_logs").insert({
      instance_id: cfg.instanceId,
      entity_type: "rr_notification",
      direction: "inbound",
      object_id: externalId,
      object_type: "rr_notification_bad_signature",
      result: "error",
      error_message: "invalid_signature",
      payload_meta: {
        event_type: eventType,
        expected_short: verify.expectedShort,
        provided_short: verify.providedShort,
      },
    });
    return errorResponse("invalid_signature", 401);
  }

  // Guard 3: запись в ledger должна существовать
  const { data: ledger } = await supabaseAdmin
    .from("rr_test_ledger")
    .select("id, status_internal, status_raw")
    .eq("external_id", externalId)
    .maybeSingle();
  if (!ledger) {
    await supabaseAdmin.from("integration_sync_logs").insert({
      instance_id: cfg.instanceId,
      entity_type: "rr_notification",
      direction: "inbound",
      object_id: externalId,
      object_type: "rr_notification_unknown_order",
      result: "skipped",
      error_message: null,
      payload_meta: { event_type: eventType, new_status: newStatus },
    });
    // 200 OK чтобы РР не ретраил бесконечно; ledger не создаём.
    return jsonResponse({ success: true, ignored: "unknown_order" });
  }

  // Idempotency: если уже применён тот же (status + sign), просто ack.
  const idempotencyKey = `${externalId}:${newStatus}:${sign.slice(0, 16)}`;
  if (ledger.status_raw === newStatus) {
    await supabaseAdmin.from("integration_sync_logs").insert({
      instance_id: cfg.instanceId,
      entity_type: "rr_notification",
      direction: "inbound",
      object_id: externalId,
      object_type: "rr_notification_duplicate",
      result: "skipped",
      error_message: null,
      payload_meta: {
        event_type: eventType,
        new_status: newStatus,
        idempotency_key_short: idempotencyKey.slice(0, 48),
      },
    });
    return jsonResponse({ success: true, duplicate: true });
  }

  // Дополнительная верификация через getOrderStatus (рекомендация РР)
  const statusRes = await rrGetOrderStatus(cfg, externalId);
  const redacted = redactRRResponse(statusRes.http.json);
  const effectiveRaw = statusRes.ok && statusRes.rrStatusRaw
    ? statusRes.rrStatusRaw
    : newStatus;
  const commission = statusRes.ok ? (statusRes.commissionMinor ?? null) : null;

  await supabaseAdmin
    .from("rr_test_ledger")
    .update({
      status_raw: effectiveRaw,
      status_internal: mapStatus(effectiveRaw),
      commission_minor: commission,
      last_notification_at: new Date().toISOString(),
      raw_last: redacted,
    })
    .eq("id", ledger.id);

  await supabaseAdmin.from("integration_sync_logs").insert({
    instance_id: cfg.instanceId,
    entity_type: "rr_notification",
    direction: "inbound",
    object_id: externalId,
    object_type: "rr_notification_applied",
    result: "success",
    error_message: null,
    payload_meta: {
      event_type: eventType,
      new_status: newStatus,
      effective_status_raw: effectiveRaw,
      idempotency_key_short: idempotencyKey.slice(0, 48),
      status_call: statusRes.http.safeCallDescriptor,
    },
  });

  return jsonResponse({ success: true });
});
