/**
 * rr-webhook (Sprint C1 — authorized promotion enabled; Sprint C2 D.2 commission enrichment marker v1)
 *
 * Порядок:
 *  1) verify signature — invalid → 401 без обращения к orders_v2;
 *  2) UUID guard для external_id;
 *  3) idempotency (external_id + newStatus + sign_hash_short) — duplicate → 200;
 *  4) lookup order: only provider='rr' AND meta.flow='rr_installment';
 *  5) append meta.rr.last_notification + provider_events (acknowledged);
 *  6) Sprint C1: newStatus ∈ {authorized, authorized_all} → promoteAuthorizedRRPayment
 *     (atomic RPC + retryable grant-access). Прочие статусы — inert.
 *  7) 200 OK всегда — сбой promotion не блокирует ACK, reconciler повторит.
 *
 * Инварианты: повторный webhook на promoted+fulfillment=completed = полный no-op;
 * hardcode продуктов/тарифов/сумм отсутствует; full sign не хранится.
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
import {
  verifyNotificationSignature,
  rrGetOrderStatus,
} from "../_shared/rr/rr-adapter.ts";
import { promoteAuthorizedRRPayment } from "../_shared/rr/rr-promote-order.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AUTHORIZE_STATUSES = new Set(["authorized", "authorized_all"]);

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
      account_code: "rr",
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
    });
    return errorResponse("invalid_signature", 401);
  }

  if (!UUID_RE.test(externalId)) {
    return jsonResponse({ success: true, ignored: "non_uuid_external_id" });
  }

  const signHashShort = await sha256Short(sign);
  const idempotencyKey = `rr:${externalId}:${newStatus}:${signHashShort}`;

  const { data: dup } = await supabaseAdmin
    .from("provider_events")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (dup) {
    return jsonResponse({ success: true, duplicate: true });
  }

  const { data: order } = await supabaseAdmin
    .from("orders_v2")
    .select("id, meta, status, provider")
    .eq("id", externalId)
    .maybeSingle();

  if (!order) {
    await supabaseAdmin.from("provider_events").insert({
      provider: "rr",
      account_code: "rr",
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
      account_code: "rr",
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

  // 5) Append last_notification + acknowledge event.
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

  const willPromote = AUTHORIZE_STATUSES.has(newStatus);

  await supabaseAdmin.from("provider_events").insert({
    provider: "rr",
    account_code: "rr",
    event_id: `${externalId}:notify:${newStatus}:${signHashShort}`,
    event_type: "webhook_notification_received",
    idempotency_key: idempotencyKey,
    payload: {
      event_type: eventType,
      new_status_raw: newStatus,
      sprint: "C1",
      will_promote: willPromote,
    },
    signature_valid: true,
    processing_status: "acknowledged",
    processed_at: nowIso,
    related_order_id: externalId,
  });

  // 6) Sprint C1 promotion path — только для authorize статусов.
  let promotion: unknown = null;
  let commissionEnrichment: unknown = null;
  if (willPromote) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      promotion = await promoteAuthorizedRRPayment(
        { supabaseAdmin, supabaseUrl, serviceRoleKey },
        {
          orderId: externalId,
          source: "rr-webhook",
          rrStatusRaw: newStatus,
          signHashShort,
        },
      );
    } catch (e) {
      // Non-fatal — reconciler повторит. Webhook возвращает 200 в любом случае.
      promotion = { ok: false, error: (e as Error).message };
    }

    // Sprint C2 D.2 — commission enrichment. Строго non-fatal:
    // ошибка status API не откатывает уже успешный promote/grant/access.
    try {
      const status = await rrGetOrderStatus(cfg, externalId);
      if (status.ok && status.commissionMinor != null) {
        const { data: finRes, error: finErr } = await supabaseAdmin.rpc(
          "rr_update_payment_financials",
          {
            _order_id: externalId,
            _commission_minor: status.commissionMinor,
            _currency: "BYN",
            _raw: {
              commission_minor: status.commissionMinor,
              rr_status_raw: status.rrStatusRaw ?? null,
            },
          },
        );
        commissionEnrichment = finErr
          ? { status: "helper_error", error: finErr.message }
          : (finRes ?? { status: "unknown" });
      } else {
        commissionEnrichment = {
          status: "status_api_no_commission",
          http_status: status.status,
          error_code: status.errorCode ?? null,
        };
      }
    } catch (e) {
      commissionEnrichment = { status: "status_api_error", error: (e as Error).message };
    }
  }

  // Sprint C2 / Этап C — runtime bridge: paid RR order → entitlement_source + aggregate recalc.
  // Строго non-fatal и идемпотентно (ON CONFLICT DO NOTHING внутри RPC). Ошибка здесь
  // не откатывает уже успешный promote/grant/access и не должна возвращать 5xx.
  let entitlementSource: unknown = null;
  const promo = promotion as { ok?: boolean } | null;
  if (willPromote && promo && promo.ok === true) {
    try {
      const { data: esRes, error: esErr } = await supabaseAdmin.rpc(
        "rr_upsert_entitlement_source_from_order",
        { _order_id: externalId },
      );
      entitlementSource = esErr
        ? { status: "helper_error", error: esErr.message }
        : (esRes ?? { status: "unknown" });
    } catch (e) {
      entitlementSource = { status: "bridge_error", error: (e as Error).message };
    }
  }

  return jsonResponse({
    success: true,
    promotion,
    commission_enrichment: commissionEnrichment,
    entitlement_source: entitlementSource,
  });
});
