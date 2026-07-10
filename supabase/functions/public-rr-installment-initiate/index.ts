/**
 * public-rr-installment-initiate (Sprint B / Gate A.1 hardened)
 *
 * Ветки reuse (RPC rr_get_or_create_pending_order, add-only durable-block кандидаты):
 *  A. Recovery (meta.rr.local_persist_failed = true):
 *     - если recovered payment_url есть → canonical rr_finalize_created_order → 200;
 *     - иначе → 503 rr_recovery_pending (без нового заказа, без rrCreateOrder).
 *  B. Reconciliation-pending (meta.rr.upstream_outcome='unknown' и
 *     reconciliation_status in ('pending','operator_required')):
 *     - 503 rr_reconciliation_pending (без нового заказа).
 *  C. Operator resolved keep_blocked/confirm_created:
 *     - если confirm_created + url → 200 c этим url;
 *     - keep_blocked → 503 rr_blocked_by_operator.
 *  D. Fresh pending / created — обычный polling / возврат url.
 *
 * Ветки нового заказа (was_reused=false):
 *  1. INSERT create_order_requested (fail-fast: 503).
 *  2. rrCreateOrder → outcomeClass:
 *     - upstream_created  → rr_finalize_created_order → 200.
 *     - upstream_rejected → rr_finalize_order_rejected (атомарно) → 502.
 *     - upstream_outcome_unknown → rr_mark_upstream_unknown (атомарно) → 504.
 *  3. Никакого fallback json.id ?? externalId. provider_request_id = только реальный json.id.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  handleCorsPreflightRequest,
  jsonResponse,
  errorResponse,
} from "../_shared/cors.ts";
import {
  createServiceClient,
  loadRRConfig,
} from "../_shared/rr/rr-config.ts";
import { redactRRResponse, rrCreateOrder } from "../_shared/rr/rr-adapter.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface InitiatePayload {
  tariff_offer_id?: string;
  name?: string;
  phone?: string;
  email?: string;
  comment?: string | null;
  website?: string;
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D+/g, "");
}
function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").slice(0, 2000);
}
async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function getClientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") || "unknown";
}

async function rateLimitOrDeny(
  supabaseAdmin: ReturnType<typeof createServiceClient>,
  buckets: { key: string; window: number; max: number }[],
): Promise<{ ok: true } | { ok: false; bucket: string }> {
  for (const b of buckets) {
    const { data, error } = await supabaseAdmin.rpc(
      "rr_public_rate_limit_hit",
      { _key: b.key, _window_seconds: b.window, _max: b.max },
    );
    if (error) continue;
    if (data === false) return { ok: false, bucket: b.key.split(":")[1] || "?" };
  }
  return { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflightRequest();
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  let body: InitiatePayload = {};
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", 400);
  }

  if (body.website && String(body.website).trim() !== "") {
    console.info(JSON.stringify({ metric: "rr_initiate_honeypot_blocked" }));
    return jsonResponse({ success: true });
  }

  const offerId = String(body.tariff_offer_id ?? "").trim();
  const nameRaw = String(body.name ?? "").trim().slice(0, 200);
  const phoneRaw = String(body.phone ?? "").trim().slice(0, 64);
  const emailRaw = String(body.email ?? "").trim();
  const email = emailRaw.toLowerCase();
  const commentRaw = body.comment == null ? null : String(body.comment);
  const comment = commentRaw == null ? null : stripHtml(commentRaw);

  if (!UUID_RE.test(offerId)) return errorResponse("tariff_offer_id_invalid", 400);
  if (nameRaw.length < 1) return errorResponse("name_invalid", 400);
  const phoneNorm = normalizePhone(phoneRaw);
  if (phoneNorm.length < 9 || phoneNorm.length > 15) {
    return errorResponse("phone_invalid", 400);
  }
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return errorResponse("email_invalid", 400);
  }

  const supabaseAdmin = createServiceClient();
  const ip = getClientIp(req);

  let userId: string | null = null;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    try {
      const jwt = authHeader.slice("Bearer ".length);
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: claimsData } = await userClient.auth.getClaims(jwt);
      userId = (claimsData?.claims?.sub as string) ?? null;
    } catch {
      userId = null;
    }
  }

  const contactHash = await sha256Hex(`${phoneNorm}|${email}`);
  const ipHash = await sha256Hex(ip);
  const offerContactHash = await sha256Hex(`${offerId}|${phoneNorm}|${email}`);
  const rl = await rateLimitOrDeny(supabaseAdmin, [
    { key: `rr_initiate:ip:${ipHash}`, window: 60, max: 20 },
    { key: `rr_initiate:contact:${contactHash}`, window: 60, max: 5 },
    { key: `rr_initiate:offer_contact:${offerContactHash}`, window: 60, max: 5 },
  ]);
  if (!rl.ok) return errorResponse(`rate_limited:${rl.bucket}`, 429);

  const { data: offer, error: offerErr } = await supabaseAdmin
    .from("tariff_offers")
    .select(
      "id, tariff_id, offer_type, amount, meta, is_active, tariffs:tariff_id(id, is_active, product_id, products_v2:product_id(id, is_active, currency))",
    )
    .eq("id", offerId)
    .maybeSingle();

  if (offerErr) return errorResponse("offer_lookup_failed", 500);
  if (!offer) return errorResponse("offer_not_found", 404);
  if (!offer.is_active) return errorResponse("offer_inactive", 403);
  if (offer.offer_type !== "bank_installment") {
    return errorResponse("offer_not_bank_installment", 403);
  }
  const rrRuntime = (offer.meta as any)?.bank_installment?.rr_runtime ?? null;
  if (!rrRuntime?.enabled || rrRuntime.provider !== "rr") {
    return errorResponse("rr_runtime_disabled", 403);
  }

  const tariff = (offer as any).tariffs;
  const product = tariff?.products_v2;
  if (!tariff?.is_active) return errorResponse("tariff_inactive", 403);
  if (!product?.is_active) return errorResponse("product_inactive", 403);

  const amountNumeric = Number(offer.amount);
  if (!Number.isFinite(amountNumeric) || amountNumeric <= 0) {
    return errorResponse("amount_invalid", 500);
  }
  const currency = String(product.currency || "BYN").toUpperCase();
  const amountMinor = Math.round(amountNumeric * 100);

  let cfg;
  try {
    cfg = await loadRRConfig(supabaseAdmin);
  } catch (e) {
    return errorResponse((e as Error).message, 503);
  }

  const correlationId = crypto.randomUUID();

  const initialMeta = {
    flow: "rr_installment",
    grant_access_skip: true,
    notification_skip: true,
    crm_success_skip: true,
    rr: {
      runtime: "sprintB",
      mode: cfg.mode,
      initiation_status: "pending",
      correlation_id: correlationId,
      contact: { name: nameRaw, phone: phoneRaw, email, phone_norm: phoneNorm },
      comment,
    },
  };

  const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc(
    "rr_get_or_create_pending_order",
    {
      _offer_id: offerId,
      _user_id: userId,
      _email_norm: email,
      _phone_norm: phoneNorm,
      _product_id: product.id,
      _tariff_id: tariff.id,
      _amount: amountNumeric,
      _currency: currency,
      _customer_email: email,
      _customer_phone: phoneRaw,
      _customer_ip: ip,
      _meta: initialMeta,
    },
  );

  if (rpcErr || !rpcData || rpcData.length === 0) {
    return errorResponse(
      `order_create_failed:${rpcErr?.message ?? "no_rpc_data"}`,
      500,
    );
  }
  const { order_id: externalId, was_reused: wasReused } = rpcData[0] as any;

  // ============== REUSE (durable-block или обычный concurrency) ==============
  if (wasReused) {
    const { data: reusedOrder } = await supabaseAdmin
      .from("orders_v2")
      .select("meta")
      .eq("id", externalId)
      .maybeSingle();
    const rr = ((reusedOrder?.meta as any)?.rr ?? {}) as Record<string, unknown>;
    const initStatus = rr.initiation_status as string | undefined;
    const url = rr.payment_url as string | undefined;
    const localPersistFailed = rr.local_persist_failed === true ||
      rr.local_persist_failed === "true";
    const upstreamOutcome = rr.upstream_outcome as string | undefined;
    const reconStatus = rr.reconciliation_status as string | undefined;
    const operatorResolution = rr.operator_resolution as string | undefined;

    // --- Ветка C: operator resolution ---
    if (reconStatus === "resolved") {
      if (operatorResolution === "confirm_created" && url) {
        return jsonResponse({
          payment_url: url,
          order_id: externalId,
          reused: true,
          source: "operator_confirm_created",
        });
      }
      if (operatorResolution === "keep_blocked") {
        return errorResponse("rr_blocked_by_operator", 503);
      }
      // allow_new_order сюда не попадает: старый заказ terminal и не reuse-кандидат.
      return errorResponse("rr_operator_pending", 503);
    }

    // --- Ветка B: ambiguous upstream ждёт reconciler ---
    if (upstreamOutcome === "unknown") {
      return errorResponse("rr_reconciliation_pending", 503);
    }

    // --- Ветка A: recovery после local_persist_failed ---
    if (localPersistFailed) {
      const recoveredUrl = rr.rr_payment_url_recovered as string | undefined;
      const recoveredReqId = rr.rr_request_id_recovered as string | null | undefined;
      if (!recoveredUrl || recoveredUrl.length === 0) {
        // Идемпотентный audit-event (best-effort).
        await supabaseAdmin.from("provider_events").insert({
          provider: "rr", account_code: "rr", signature_valid: true,
          event_id: `${externalId}:recovery_blocked_no_url`,
          event_type: "recovery_blocked_no_url",
          idempotency_key: `${externalId}:recovery_blocked_no_url`,
          payload: { correlation_id: correlationId },
          processing_status: "pending",
          related_order_id: externalId,
        });
        return errorResponse("rr_recovery_pending", 503);
      }
      // Canonical финализация — тем же RPC, что и happy path.
      const { error: finErr } = await supabaseAdmin.rpc(
        "rr_finalize_created_order",
        {
          _order_id: externalId,
          _payment_url: recoveredUrl,
          _rr_request_id: recoveredReqId ?? null,
          _rr_status_raw: null,
          _raw_last: { source: "recovery" },
          _correlation_id: correlationId,
        },
      );
      if (finErr) {
        console.error(JSON.stringify({
          stage: "recovery_finalize",
          order_id: externalId,
          error: finErr.message,
        }));
        return errorResponse("rr_recovery_finalize_failed", 503);
      }
      // Audit-only событие (идемпотентно, best-effort).
      await supabaseAdmin.from("provider_events").insert({
        provider: "rr", account_code: "rr", signature_valid: true,
        event_id: `${externalId}:create_order_recovered`,
        event_type: "create_order_recovered",
        idempotency_key: `${externalId}:create_order_recovered`,
        payload: { correlation_id: correlationId },
        processing_status: "processed",
        processed_at: new Date().toISOString(),
        related_order_id: externalId,
      });
      return jsonResponse({
        payment_url: recoveredUrl,
        order_id: externalId,
        reused: true,
        recovered: true,
      });
    }

    // --- Ветка D: обычный concurrency reuse ---
    const deadline = Date.now() + 15_000;
    let curUrl = url;
    let curStatus = initStatus;
    while (Date.now() < deadline && (curStatus !== "created" || !curUrl)) {
      await new Promise((r) => setTimeout(r, 400));
      const { data: pollOrder } = await supabaseAdmin
        .from("orders_v2").select("meta").eq("id", externalId).maybeSingle();
      const pr = ((pollOrder?.meta as any)?.rr ?? {}) as Record<string, unknown>;
      curUrl = pr.payment_url as string | undefined;
      curStatus = pr.initiation_status as string | undefined;
      if (curStatus === "failed") {
        return errorResponse("rr_create_order_failed_upstream", 502);
      }
      if ((pr.upstream_outcome as string | undefined) === "unknown") {
        return errorResponse("rr_reconciliation_pending", 503);
      }
      if (pr.local_persist_failed === true || pr.local_persist_failed === "true") {
        return errorResponse("rr_recovery_pending", 503);
      }
    }
    if (!curUrl) return errorResponse("rr_reuse_wait_timeout", 504);
    return jsonResponse({ payment_url: curUrl, order_id: externalId, reused: true });
  }

  // ============== NEW ORDER — инициализация в РР ==============
  const reqInsert = await supabaseAdmin.from("provider_events").insert({
    provider: "rr", account_code: "rr", signature_valid: true,
    event_id: `${externalId}:create_order_requested`,
    event_type: "create_order_requested",
    idempotency_key: `${externalId}:create_order_requested`,
    payload: {
      amount_minor: amountMinor,
      currency,
      offer_id: offerId,
      correlation_id: correlationId,
      mode: cfg.mode,
    },
    processing_status: "pending",
    related_order_id: externalId,
  });
  if (reqInsert.error) {
    console.error(JSON.stringify({
      stage: "create_order_requested_persist",
      order_id: externalId,
      error: reqInsert.error.message,
    }));
    return errorResponse("persist_failed_pre_call", 503);
  }

  const projectRef = (Deno.env.get("SUPABASE_URL") ?? "").match(
    /https:\/\/([^.]+)\.supabase\.co/,
  )?.[1];
  const notificationUrl = projectRef
    ? `https://${projectRef}.supabase.co/functions/v1/rr-webhook`
    : `${Deno.env.get("SUPABASE_URL")}/functions/v1/rr-webhook`;

  const rrRes = await rrCreateOrder(cfg, {
    externalId,
    amountMinor,
    currency,
    notificationUrl,
    correlationId,
  });
  const redacted = redactRRResponse(rrRes.http.json);

  // ---------- Классификация исхода ----------
  if (rrRes.outcomeClass === "upstream_rejected") {
    // Атомарный terminal finalizer.
    const { error: rejErr } = await supabaseAdmin.rpc(
      "rr_finalize_order_rejected",
      {
        _order_id: externalId,
        _reason_code: rrRes.errorText ?? "rr_upstream_rejected",
        _http_status: rrRes.status,
        _response_snippet: redacted,
      },
    );
    if (rejErr) {
      console.error(JSON.stringify({
        stage: "reject_finalize", order_id: externalId, error: rejErr.message,
      }));
    }
    return errorResponse("rr_create_order_rejected", 502);
  }

  if (rrRes.outcomeClass === "upstream_outcome_unknown") {
    // Атомарная маркировка неопределённого исхода.
    const { error: unkErr } = await supabaseAdmin.rpc(
      "rr_mark_upstream_unknown",
      {
        _order_id: externalId,
        _provider_request_id: rrRes.providerRequestId,
        _failure_kind: rrRes.failureKind,
        _http_status: rrRes.status,
        _correlation_id: correlationId,
      },
    );
    if (unkErr) {
      console.error(JSON.stringify({
        stage: "mark_unknown", order_id: externalId, error: unkErr.message,
      }));
    }
    return errorResponse("rr_upstream_unknown", 504);
  }

  // upstream_created — обязательно paymentUrl валиден (adapter гарантирует).
  const paymentUrl = rrRes.paymentUrl!;
  const providerRequestId = rrRes.providerRequestId; // может быть null — сохраняем как есть.

  const { error: finalizeErr } = await supabaseAdmin.rpc(
    "rr_finalize_created_order",
    {
      _order_id: externalId,
      _payment_url: paymentUrl,
      _rr_request_id: providerRequestId,
      _rr_status_raw: rrRes.rrStatusRaw ?? null,
      _raw_last: redacted,
      _correlation_id: correlationId,
    },
  );

  if (finalizeErr) {
    // РР создал заявку с валидным URL — локальная финализация упала.
    // Маркер local_persist_failed, чтобы reuse RPC вернул этот же заказ recovery-веткой.
    console.error(JSON.stringify({
      stage: "finalize_persist",
      order_id: externalId,
      provider_request_id: providerRequestId,
      payment_url_present: true,
      error: finalizeErr.message,
    }));

    await supabaseAdmin.rpc("rr_mark_local_persist_failed", {
      _order_id: externalId,
      _payment_url: paymentUrl,
      _rr_request_id: providerRequestId,
      _error_text: finalizeErr.message.slice(0, 500),
    });

    await supabaseAdmin.from("provider_events").insert({
      provider: "rr", account_code: "rr", signature_valid: true,
      event_id: `${externalId}:create_order_persist_failed:${Date.now()}`,
      event_type: "create_order_persist_failed",
      idempotency_key: `${externalId}:create_order_persist_failed`,
      payload: {
        provider_request_id: providerRequestId,
        payment_url_len: paymentUrl.length,
        error: finalizeErr.message,
        raw_last: redacted,
      },
      processing_status: "failed",
      processing_error: finalizeErr.message.slice(0, 500),
      related_order_id: externalId,
    });

    return errorResponse("local_persist_failed", 502);
  }

  return jsonResponse({
    payment_url: paymentUrl,
    order_id: externalId,
    reused: false,
  });
});
