/**
 * public-rr-installment-initiate (Sprint B / Gate A.1 v3 hardened)
 *
 * Инвариант fail-closed: НИКОГДА не отдавать клиенту "безопасный" статус
 * без подтверждённой durable записи. Если БД не отвечает — HTTP 500
 * local_state_unconfirmed, а не 502/503/504.
 *
 * Ключевое отличие v3: pre-call durable marker (rr_mark_call_started)
 * пишется ДО обращения к банку. Заказ с активным маркером всегда
 * переиспользуется той же identity (без временных окон), пока не наступит
 * terminal outcome. Это гарантирует, что даже двойной сбой post-call
 * marker не приведёт к повторному createOrder.
 *
 * Ветки reuse (rr_get_or_create_pending_order):
 *  A.1 upstream_call_state='started' без terminal → 503 rr_call_in_flight;
 *  A.  local_persist_failed=true + recovered URL → canonical finalizer → 200;
 *      без recovered URL → 503 rr_recovery_pending;
 *  B.  upstream_outcome='unknown' → 503 rr_reconciliation_pending;
 *  C.  operator resolved: confirm_created+URL → 200; keep_blocked → 503.
 *  D.  свежий pending (concurrency happy-path) → polling или готовый URL.
 *
 * Ветки нового заказа:
 *  1. Атомарная запись create_order_requested (fail-fast: 503).
 *  2. rr_mark_call_started — pre-call durable marker (1 retry).
 *     При неудаче: 500 local_state_unconfirmed, rrCreateOrder НЕ вызывается.
 *  3. rrCreateOrder → outcomeClass:
 *     upstream_created  → rr_finalize_created_order (retry + persist_failed marker) → 200;
 *     upstream_rejected → rr_finalize_order_rejected (retry) → 502 или 500;
 *     upstream_outcome_unknown → rr_mark_upstream_unknown (retry) → 504 или 500.
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

type SbAdmin = ReturnType<typeof createServiceClient>;

async function rateLimitOrDeny(
  supabaseAdmin: SbAdmin,
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

// Небольшая controlled retry для критических marker RPC.
// Одна повторная попытка через 150 мс. Возвращает финальный error (или null).
async function callWithSingleRetry<T = unknown>(
  fn: () => Promise<{ data: T | null; error: { message: string } | null }>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  const first = await fn();
  if (!first.error) return first;
  await new Promise((r) => setTimeout(r, 150));
  return await fn();
}

// Best-effort идемпотентный аудит через RPC.
// Не блокирует ответ; ошибки только логируются.
async function auditEvent(
  supabaseAdmin: SbAdmin,
  orderId: string,
  eventType:
    | "recovery_blocked_no_url"
    | "create_order_recovered"
    | "local_state_unconfirmed"
    | "audit_write_failed",
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc(
    "rr_insert_idempotent_audit_event",
    {
      _order_id: orderId,
      _event_type: eventType,
      _payload: payload,
    },
  );
  if (error) {
    console.error(JSON.stringify({
      stage: "audit_event_write_failed",
      order_id: orderId,
      event_type: eventType,
      error: error.message,
    }));
  }
}

// Redacted ALERT log для local_state_unconfirmed.
// Никаких PII / полных URL / raw response.
function alertLocalStateUnconfirmed(
  orderId: string,
  correlationId: string,
  stage: string,
  failureKind: string | null,
  httpStatus: number | null,
  providerRequestId: string | null,
  errorMsg: string,
): void {
  console.error(JSON.stringify({
    metric: "rr_local_state_unconfirmed",
    level: "ALERT",
    order_id: orderId,
    correlation_id: correlationId,
    stage,
    failure_kind: failureKind,
    http_status: httpStatus,
    provider_request_id: providerRequestId,
    error_short: (errorMsg || "").slice(0, 200),
  }));
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

  // ============== REUSE ==============
  if (wasReused) {
    const { data: reusedOrder, error: reuseReadErr } = await supabaseAdmin
      .from("orders_v2")
      .select("meta")
      .eq("id", externalId)
      .maybeSingle();
    if (reuseReadErr) {
      console.error(JSON.stringify({
        stage: "reuse_state_read", order_id: externalId,
        error: reuseReadErr.message,
      }));
      return errorResponse("rr_reuse_state_read_failed", 500);
    }
    const rr = ((reusedOrder?.meta as any)?.rr ?? {}) as Record<string, unknown>;
    const initStatus = rr.initiation_status as string | undefined;
    const url = rr.payment_url as string | undefined;
    const localPersistFailed = rr.local_persist_failed === true ||
      rr.local_persist_failed === "true";
    const upstreamOutcome = rr.upstream_outcome as string | undefined;
    const reconStatus = rr.reconciliation_status as string | undefined;
    const operatorResolution = rr.operator_resolution as string | undefined;
    const callState = rr.upstream_call_state as string | undefined;

    // A.1 pre-call marker активен и не завершён — call in-flight.
    if (
      callState === "started" &&
      initStatus !== "created" && initStatus !== "failed"
    ) {
      return errorResponse("rr_call_in_flight", 503);
    }

    // C: operator resolution
    if (reconStatus === "resolved") {
      if (operatorResolution === "confirm_created" && url) {
        return jsonResponse({
          payment_url: url, order_id: externalId, reused: true,
          source: "operator_confirm_created",
        });
      }
      if (operatorResolution === "keep_blocked") {
        return errorResponse("rr_blocked_by_operator", 503);
      }
      return errorResponse("rr_operator_pending", 503);
    }

    // B: ambiguous upstream ждёт reconciler
    if (upstreamOutcome === "unknown") {
      return errorResponse("rr_reconciliation_pending", 503);
    }

    // A: recovery
    if (localPersistFailed) {
      const recoveredUrl = rr.rr_payment_url_recovered as string | undefined;
      const recoveredReqId = rr.rr_request_id_recovered as string | null | undefined;
      if (!recoveredUrl || recoveredUrl.length === 0) {
        await auditEvent(supabaseAdmin, externalId, "recovery_blocked_no_url", {
          correlation_id: correlationId,
        });
        return errorResponse("rr_recovery_pending", 503);
      }
      const { error: finErr } = await callWithSingleRetry(async () =>
        await supabaseAdmin.rpc("rr_finalize_created_order", {
          _order_id: externalId,
          _payment_url: recoveredUrl,
          _rr_request_id: recoveredReqId ?? null,
          _rr_status_raw: null,
          _raw_last: { source: "recovery" },
          _correlation_id: correlationId,
        })
      );
      if (finErr) {
        alertLocalStateUnconfirmed(
          externalId, correlationId, "recovery_finalize",
          null, null, recoveredReqId ?? null, finErr.message,
        );
        await auditEvent(supabaseAdmin, externalId, "local_state_unconfirmed", {
          correlation_id: correlationId, stage: "recovery_finalize",
        });
        return errorResponse("local_state_unconfirmed", 500);
      }
      await auditEvent(supabaseAdmin, externalId, "create_order_recovered", {
        correlation_id: correlationId,
      });
      return jsonResponse({
        payment_url: recoveredUrl, order_id: externalId,
        reused: true, recovered: true,
      });
    }

    // D: обычный concurrency reuse
    const deadline = Date.now() + 15_000;
    let curUrl = url;
    let curStatus = initStatus;
    while (Date.now() < deadline && (curStatus !== "created" || !curUrl)) {
      await new Promise((r) => setTimeout(r, 400));
      const { data: pollOrder, error: pollErr } = await supabaseAdmin
        .from("orders_v2").select("meta").eq("id", externalId).maybeSingle();
      if (pollErr) {
        console.error(JSON.stringify({
          stage: "reuse_poll", order_id: externalId, error: pollErr.message,
        }));
        return errorResponse("rr_reuse_poll_read_failed", 500);
      }
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
      if ((pr.upstream_call_state as string | undefined) === "started" &&
          curStatus !== "created") {
        // всё ещё call in flight у соседнего запроса — продолжаем poll.
        continue;
      }
    }
    if (!curUrl) return errorResponse("rr_reuse_wait_timeout", 504);
    return jsonResponse({ payment_url: curUrl, order_id: externalId, reused: true });
  }

  // ============== NEW ORDER ==============
  // 1. Идемпотентный create_order_requested (fail-fast: 503).
  const reqInsert = await supabaseAdmin.from("provider_events").insert({
    provider: "rr", account_code: "rr", signature_valid: true,
    event_id: `${externalId}:create_order_requested`,
    event_type: "create_order_requested",
    idempotency_key: `${externalId}:create_order_requested`,
    payload: {
      amount_minor: amountMinor, currency, offer_id: offerId,
      correlation_id: correlationId, mode: cfg.mode,
    },
    processing_status: "pending",
    related_order_id: externalId,
  });
  if (reqInsert.error) {
    // Уникальное нарушение — приемлемо (идемпотентно): продолжаем.
    const msg = reqInsert.error.message || "";
    if (!/duplicate key|idempotency_key/i.test(msg)) {
      console.error(JSON.stringify({
        stage: "create_order_requested_persist",
        order_id: externalId, error: msg,
      }));
      return errorResponse("persist_failed_pre_call", 503);
    }
  }

  // 2. Pre-call durable marker — ОБЯЗАТЕЛЬНО ДО rrCreateOrder.
  //    Гарантирует, что при любом дальнейшем сбое reuse RPC вернёт
  //    именно этот заказ (без временных окон).
  const { data: callStartData, error: callStartErr } = await callWithSingleRetry(
    async () => await supabaseAdmin.rpc("rr_mark_call_started", {
      _order_id: externalId,
      _correlation_id: correlationId,
    }),
  );
  if (callStartErr) {
    alertLocalStateUnconfirmed(
      externalId, correlationId, "mark_call_started",
      null, null, null, callStartErr.message,
    );
    // rrCreateOrder НЕ вызываем — банк не тронут.
    return errorResponse("persist_failed_pre_call", 503);
  }
  const callStartResult = (callStartData ?? {}) as Record<string, unknown>;
  if (callStartResult.ok !== true) {
    alertLocalStateUnconfirmed(
      externalId, correlationId, "mark_call_started_result",
      null, null, null, `unexpected_result:${JSON.stringify(callStartResult).slice(0, 100)}`,
    );
    return errorResponse("persist_failed_pre_call", 503);
  }

  const projectRef = (Deno.env.get("SUPABASE_URL") ?? "").match(
    /https:\/\/([^.]+)\.supabase\.co/,
  )?.[1];
  const notificationUrl = projectRef
    ? `https://${projectRef}.supabase.co/functions/v1/rr-webhook`
    : `${Deno.env.get("SUPABASE_URL")}/functions/v1/rr-webhook`;

  // 3. Вызов РР (pre-call marker уже durable записан).
  const rrRes = await rrCreateOrder(cfg, {
    externalId, amountMinor, currency, notificationUrl, correlationId,
  });
  const redacted = redactRRResponse(rrRes.http.json);

  // 4. Классификация исхода.
  if (rrRes.outcomeClass === "upstream_rejected") {
    const { error: rejErr } = await callWithSingleRetry(async () =>
      await supabaseAdmin.rpc("rr_finalize_order_rejected", {
        _order_id: externalId,
        _reason_code: rrRes.errorText ?? "rr_upstream_rejected",
        _http_status: rrRes.status,
        _response_snippet: redacted,
      })
    );
    if (rejErr) {
      alertLocalStateUnconfirmed(
        externalId, correlationId, "reject_finalize",
        rrRes.failureKind, rrRes.status, rrRes.providerRequestId, rejErr.message,
      );
      await auditEvent(supabaseAdmin, externalId, "local_state_unconfirmed", {
        correlation_id: correlationId, stage: "reject_finalize",
      });
      return errorResponse("local_state_unconfirmed", 500);
    }
    return errorResponse("rr_create_order_rejected", 502);
  }

  if (rrRes.outcomeClass === "upstream_outcome_unknown") {
    const { error: unkErr } = await callWithSingleRetry(async () =>
      await supabaseAdmin.rpc("rr_mark_upstream_unknown", {
        _order_id: externalId,
        _provider_request_id: rrRes.providerRequestId,
        _failure_kind: rrRes.failureKind,
        _http_status: rrRes.status,
        _correlation_id: correlationId,
      })
    );
    if (unkErr) {
      alertLocalStateUnconfirmed(
        externalId, correlationId, "mark_unknown",
        rrRes.failureKind, rrRes.status, rrRes.providerRequestId, unkErr.message,
      );
      await auditEvent(supabaseAdmin, externalId, "local_state_unconfirmed", {
        correlation_id: correlationId, stage: "mark_unknown",
      });
      return errorResponse("local_state_unconfirmed", 500);
    }
    return errorResponse("rr_upstream_unknown", 504);
  }

  // upstream_created — payment_url валиден (adapter гарантирует).
  const paymentUrl = rrRes.paymentUrl!;
  const providerRequestId = rrRes.providerRequestId;

  const { error: finalizeErr } = await callWithSingleRetry(async () =>
    await supabaseAdmin.rpc("rr_finalize_created_order", {
      _order_id: externalId,
      _payment_url: paymentUrl,
      _rr_request_id: providerRequestId,
      _rr_status_raw: rrRes.rrStatusRaw ?? null,
      _raw_last: redacted,
      _correlation_id: correlationId,
    })
  );

  if (finalizeErr) {
    // РР создал заявку с валидным URL — локальная финализация упала.
    // Пробуем поставить local_persist_failed marker с 1 retry.
    console.error(JSON.stringify({
      stage: "finalize_persist", order_id: externalId,
      provider_request_id: providerRequestId,
      payment_url_present: true, error: finalizeErr.message,
    }));

    const { error: markErr } = await callWithSingleRetry(async () =>
      await supabaseAdmin.rpc("rr_mark_local_persist_failed", {
        _order_id: externalId,
        _payment_url: paymentUrl,
        _rr_request_id: providerRequestId,
        _error_text: finalizeErr.message.slice(0, 500),
      })
    );

    if (markErr) {
      // Ни canonical finalize, ни recovery marker не подтверждены.
      // fail-closed: pre-call marker всё равно активен → reuse вернёт этот же заказ.
      alertLocalStateUnconfirmed(
        externalId, correlationId, "persist_failed_marker",
        rrRes.failureKind, rrRes.status, providerRequestId,
        `finalize:${finalizeErr.message}|mark:${markErr.message}`,
      );
      await auditEvent(supabaseAdmin, externalId, "local_state_unconfirmed", {
        correlation_id: correlationId, stage: "persist_failed_marker",
      });
      return errorResponse("local_state_unconfirmed", 500);
    }

    // marker durable записан.
    return errorResponse("local_persist_failed", 502);
  }

  return jsonResponse({
    payment_url: paymentUrl, order_id: externalId, reused: false,
  });
});
