/**
 * public-rr-installment-initiate (Sprint B)
 *
 * ЖЁСТКИЕ ГРАНИЦЫ Sprint B:
 *  - Создаёт только orders_v2 (status='pending', meta.flow='rr_installment')
 *    и провайдерскую заявку в РР через createOrder.
 *  - НЕ создаёт payments_v2, entitlements, telegram-доступы, CRM success.
 *  - НЕ вызывает grant-access-for-order.
 *  - external_id для РР = orders_v2.id (единый source of truth, никаких rr_live_*).
 *  - amount/currency/tariff_id/product_id читаются сервером из tariff_offers;
 *    клиент передаёт только tariff_offer_id + контактные данные.
 *  - Runtime включается только на офферах с
 *    meta.bank_installment.rr_runtime.enabled === true.
 *  - Идемпотентность: если у того же оффера+email уже есть pending заказ
 *    с валидным payment_url младше 30 минут — возвращаем его повторно.
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
  website?: string; // honeypot
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

  // honeypot
  if (body.website && body.website.trim() !== "") {
    return jsonResponse({ success: true, skipped: "honeypot" });
  }

  const offerId = String(body.tariff_offer_id ?? "").trim();
  const name = String(body.name ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const comment = body.comment == null
    ? null
    : String(body.comment).slice(0, 2000);

  if (!UUID_RE.test(offerId)) return errorResponse("tariff_offer_id_invalid", 400);
  if (name.length < 1 || name.length > 200) {
    return errorResponse("name_invalid", 400);
  }
  if (phone.length < 5 || phone.length > 32) {
    return errorResponse("phone_invalid", 400);
  }
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return errorResponse("email_invalid", 400);
  }

  const supabaseAdmin = createServiceClient();

  // Опциональная авторизация: если есть JWT — читаем user_id, иначе public flow.
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

  // Резолв оффера + тарифа + продукта (source of truth — server-side).
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

  const rrRuntime =
    (offer.meta as any)?.bank_installment?.rr_runtime ?? null;
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

  // Идемпотентность: ищем существующий pending заказ по (offer_id + email)
  // с уже полученным payment_url младше 30 минут.
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: existing } = await supabaseAdmin
    .from("orders_v2")
    .select("id, meta, created_at")
    .eq("offer_id", offerId)
    .eq("status", "pending")
    .eq("customer_email", email)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const existingMeta = (existing.meta ?? {}) as any;
    const existingUrl = existingMeta?.rr?.payment_url as string | undefined;
    if (existingMeta?.flow === "rr_installment" && existingUrl) {
      return jsonResponse({
        payment_url: existingUrl,
        order_id: existing.id,
        reused: true,
      });
    }
  }

  const correlationId = crypto.randomUUID();

  // 1) Создаём orders_v2 (промежуточный)
  const insertMeta = {
    flow: "rr_installment",
    grant_access_skip: true,
    notification_skip: true,
    crm_success_skip: true,
    rr: {
      runtime: "sprintB",
      mode: cfg.mode,
      correlation_id: correlationId,
      contact: { name, phone, email },
      comment,
    },
  };

  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders_v2")
    .insert({
      product_id: product.id,
      tariff_id: tariff.id,
      offer_id: offerId,
      base_price: amountNumeric,
      final_price: amountNumeric,
      currency,
      status: "pending",
      provider: "rr",
      customer_email: email,
      customer_phone: phone,
      user_id: userId,
      meta: insertMeta,
    })
    .select("id")
    .single();

  if (orderErr || !order) {
    return errorResponse(
      `order_create_failed:${orderErr?.message ?? "unknown"}`,
      500,
    );
  }

  const externalId = order.id as string;

  // 2) provider_events: create_order_requested
  await supabaseAdmin.from("provider_events").insert({
    provider: "rr",
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

  // 3) createOrder в РР. Notification URL — наша rr-webhook (Sprint B: noop-приёмник).
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
    await supabaseAdmin
      .from("orders_v2")
      .update({
        meta: {
          ...insertMeta,
          rr: {
            ...insertMeta.rr,
            error: rrRes.errorText ?? "rr_create_order_failed",
            raw_last: redacted,
            http_status: rrRes.status,
          },
        },
      })
      .eq("id", externalId);

    await supabaseAdmin.from("provider_events").insert({
      provider: "rr",
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

  // 4) success: сохраняем payment_url в meta + provider_events succeeded
  await supabaseAdmin
    .from("orders_v2")
    .update({
      meta: {
        ...insertMeta,
        rr: {
          ...insertMeta.rr,
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
