/**
 * public-rr-installment-initiate (Sprint B — hardened)
 *
 * SoT: tariff_offer_id + контакт. amount/currency/tariff/product сервер читает
 * сам, клиент их не передаёт. external_id для РР = orders_v2.id.
 *
 * Границы Sprint B:
 *  - Создаёт только orders_v2 (status='pending', meta.flow='rr_installment',
 *    meta.rr.initiation_status='created'|'failed').
 *  - НЕ создаёт payments_v2, entitlements, telegram-доступы, CRM success.
 *  - НЕ вызывает grant-access-for-order.
 *
 * Hardening:
 *  1) Нормализация PII: email lower/trim; phone_norm — только цифры, 9..15.
 *  2) Идемпотентность через RPC rr_get_or_create_pending_order (advisory lock).
 *     Reuse только для того же (offer, user_id, email_norm, phone_norm),
 *     с непустым payment_url, initiation_status='created', возрастом < 30 мин.
 *  3) Failed createOrder переводит заказ в meta.rr.initiation_status='failed' —
 *     не переиспользуется reuse-логикой.
 *  4) Durable rate limit (таблица + RPC): 3 независимых bucket'а
 *     — ip, contact(phone|email), offer+contact.
 *  5) PII не попадает в provider_events.payload и в ответы клиенту.
 *  6) Honeypot поле website.
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
import {
  redactRRResponse,
  rrCreateOrder,
} from "../_shared/rr/rr-adapter.ts";

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
    if (error) continue; // fail-open on rate-limit backend error, no exception
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
    // Honeypot: neutral success response. NO skipped/reason marker in HTTP body,
    // NO provider_events insert (bot would spam the ledger), NO PII in logs.
    // Only an obfuscated server-side metric log line for ops visibility.
    // eslint-disable-next-line no-console
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

  // Опциональная авторизация: user_id — только для reuse-scope.
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

  // Rate limits (durable, DB-backed). fail-open при ошибке RPC.
  const contactHash = await sha256Hex(`${phoneNorm}|${email}`);
  const ipHash = await sha256Hex(ip);
  const offerContactHash = await sha256Hex(`${offerId}|${phoneNorm}|${email}`);
  const rl = await rateLimitOrDeny(supabaseAdmin, [
    { key: `rr_initiate:ip:${ipHash}`, window: 60, max: 20 },
    { key: `rr_initiate:contact:${contactHash}`, window: 60, max: 5 },
    { key: `rr_initiate:offer_contact:${offerContactHash}`, window: 60, max: 5 },
  ]);
  if (!rl.ok) return errorResponse(`rate_limited:${rl.bucket}`, 429);

  // Резолв оффера (server-side SoT).
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

  // Concurrent-safe reuse-or-create через RPC (advisory lock).
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
      // PII операционного контакта — только для operator-view (RLS orders_v2).
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

  if (wasReused) {
    // Reuse: RPC вернул либо уже готовый (initiation_status='created' + payment_url),
    // либо ещё инициализирующийся (pending, <120с). Во втором случае polling — up to 15s.
    const deadline = Date.now() + 15_000;
    let url: string | undefined;
    let initStatus: string | undefined;
    while (Date.now() < deadline) {
      const { data: reusedOrder } = await supabaseAdmin
        .from("orders_v2")
        .select("meta")
        .eq("id", externalId)
        .maybeSingle();
      const rr = (reusedOrder?.meta as any)?.rr ?? {};
      url = rr.payment_url as string | undefined;
      initStatus = rr.initiation_status as string | undefined;
      if (initStatus === "created" && url) break;
      if (initStatus === "failed") {
        return errorResponse("rr_create_order_failed_upstream", 502);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    if (!url) {
      return errorResponse("rr_reuse_wait_timeout", 504);
    }
    return jsonResponse({
      payment_url: url,
      order_id: externalId,
      reused: true,
    });
  }

  // Новый заказ — начинаем инициализацию РР.
  await supabaseAdmin.from("provider_events").insert({
    provider: "rr",
    account_code: "rr",
    signature_valid: true,
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

  if (!rrRes.ok || !rrRes.paymentUrl) {
    // Пометить заказ как failed: не reusable.
    const { data: cur } = await supabaseAdmin
      .from("orders_v2").select("meta").eq("id", externalId).maybeSingle();
    const curMeta = (cur?.meta ?? {}) as any;
    await supabaseAdmin
      .from("orders_v2")
      .update({
        meta: {
          ...curMeta,
          rr: {
            ...(curMeta.rr ?? {}),
            initiation_status: "failed",
            error_code: rrRes.errorText ?? "rr_create_order_failed",
            error_at: new Date().toISOString(),
            http_status: rrRes.status,
            raw_last: redacted,
          },
        },
      })
      .eq("id", externalId);

    await supabaseAdmin.from("provider_events").insert({
      provider: "rr",
    account_code: "rr",
    signature_valid: true,
      event_id: `${externalId}:create_order_failed`,
      event_type: "create_order_failed",
      idempotency_key: `${externalId}:create_order_failed`,
      payload: {
        error: rrRes.errorText ?? "rr_create_order_failed",
        http_status: rrRes.status,
        raw_last: redacted,
      },
      processing_status: "failed",
      processing_error: rrRes.errorText ?? null,
      related_order_id: externalId,
    });

    return errorResponse("rr_create_order_failed", 502);
  }

  // Success — сохраняем payment_url + initiation_status='created'.
  const { data: cur2 } = await supabaseAdmin
    .from("orders_v2").select("meta").eq("id", externalId).maybeSingle();
  const cur2Meta = (cur2?.meta ?? {}) as any;
  await supabaseAdmin
    .from("orders_v2")
    .update({
      meta: {
        ...cur2Meta,
        rr: {
          ...(cur2Meta.rr ?? {}),
          initiation_status: "created",
          payment_url: rrRes.paymentUrl,
          rr_request_id: rrRes.rrRequestId ?? externalId,
          rr_status_raw: rrRes.rrStatusRaw ?? null,
          raw_last: redacted,
        },
      },
    })
    .eq("id", externalId);

  await supabaseAdmin.from("provider_events").insert({
    provider: "rr",
    account_code: "rr",
    signature_valid: true,
    event_id: `${externalId}:create_order_succeeded`,
    event_type: "create_order_succeeded",
    idempotency_key: `${externalId}:create_order_succeeded`,
    payload: {
      payment_url: rrRes.paymentUrl,
      rr_request_id: rrRes.rrRequestId ?? externalId,
      rr_status_raw: rrRes.rrStatusRaw ?? null,
      raw_last: redacted,
    },
    processing_status: "processed",
    processed_at: new Date().toISOString(),
    related_order_id: externalId,
  });

  return jsonResponse({
    payment_url: rrRes.paymentUrl,
    order_id: externalId,
    reused: false,
  });
});
