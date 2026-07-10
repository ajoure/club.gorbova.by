/**
 * rr-webhook (Sprint B — inert, hardened)
 *
 * Порядок обязательный:
 *  1) verify signature — при invalid: 401, redacted event БЕЗ обращения к orders_v2;
 *  2) UUID guard для external_id;
 *  3) idempotency: (external_id + newStatus + sign_hash_short) — duplicate → 200 без эффектов;
 *  4) lookup order: only provider='rr' AND meta.flow='rr_installment';
 *     unknown/mismatched → 200 { ignored } без INSERT/UPDATE в orders_v2;
 *  5) append meta.rr.last_notification + provider_events (acknowledged);
 *  6) 200 OK.
 *
 * Sprint B принципиально:
 *  - НЕ обновляет orders_v2.status,
 *  - НЕ пишет payments_v2,
 *  - НЕ вызывает grant-access-for-order,
 *  - НЕ триггерит CRM/notifications.
 *
 * Полная подпись НЕ хранится ни в idempotency_key, ни в payload — только SHA-256 short.
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

  // 1) Signature FIRST — до любых обращений к orders_v2.
  const verify = await verifyNotificationSignature({
    newStatus,
    salt,
    sign,
    secretKey: cfg.secretKey,
  });
  if (!verify.valid) {
    const signHashShort = sign ? await sha256Short(sign) : "empty";
    await supabaseAdmin.from("provider_events").insert({
      provider: "rr",
      event_id: `rr:badsig:${signHashShort}:${Date.now()}`,
      event_type: "webhook_bad_signature",
      idempotency_key: `rr:badsig:${signHashShort}:${newStatus}:${externalId || "no_id"}`,
      payload: {
        external_id_present: !!externalId,
        expected_short: verify.expectedShort,
        provided_short: verify.providedShort,
        event_type_raw: eventType,
      },
      signature_valid: false,
      processing_status: "rejected",
      processing_error: "invalid_signature",
      // related_order_id намеренно НЕ проставляем — не создаём фиктивную связь.
    });
    return errorResponse("invalid_signature", 401);
  }

  // 2) UUID guard.
  if (!UUID_RE.test(externalId)) {
    return jsonResponse({ success: true, ignored: "non_uuid_external_id" });
  }

  const signHashShort = await sha256Short(sign);
  const idempotencyKey = `rr:${externalId}:${newStatus}:${signHashShort}`;

  // 3) Duplicate check.
  const { data: dup } = await supabaseAdmin
    .from("provider_events")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (dup) {
    return jsonResponse({ success: true, duplicate: true });
  }

  // 4) Order lookup — только rr + rr_installment.
  const { data: order } = await supabaseAdmin
    .from("orders_v2")
    .select("id, meta, status, provider")
    .eq("id", externalId)
    .maybeSingle();

  if (!order) {
    // Никаких INSERT в orders_v2. Пишем redacted event с idempotency_key,
    // чтобы повторные unknown-нотификации не спамили.
    await supabaseAdmin.from("provider_events").insert({
      provider: "rr",
      event_id: `${externalId}:unknown:${signHashShort}`,
      event_type: "webhook_unknown_order",
      idempotency_key: idempotencyKey,
      payload: { new_status_raw: newStatus, event_type: eventType },
      signature_valid: true,
      processing_status: "ignored",
    });
    return jsonResponse({ success: true, ignored: "unknown_order" });
  }

  const meta = (order.meta ?? {}) as any;
  if (order.provider !== "rr" || meta?.flow !== "rr_installment") {
    await supabaseAdmin.from("provider_events").insert({
      provider: "rr",
      event_id: `${externalId}:not_rr_flow:${signHashShort}`,
      event_type: "webhook_not_rr_installment",
      idempotency_key: idempotencyKey,
      payload: { new_status_raw: newStatus, event_type: eventType },
      signature_valid: true,
      processing_status: "ignored",
      related_order_id: externalId,
    });
    return jsonResponse({ success: true, ignored: "not_rr_installment" });
  }

  // 5) Append last_notification в meta (без status), event acknowledged.
  const nowIso = new Date().toISOString();
  const rrMeta = { ...(meta.rr ?? {}) };
  rrMeta.last_notification = {
    at: nowIso,
    event_type: eventType || null,
    new_status_raw: newStatus,
    sign_hash_short: signHashShort,
  };
  await supabaseAdmin
    .from("orders_v2")
    .update({ meta: { ...meta, rr: rrMeta } })
    .eq("id", externalId);

  await supabaseAdmin.from("provider_events").insert({
    provider: "rr",
    event_id: `${externalId}:notify:${newStatus}:${signHashShort}`,
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
