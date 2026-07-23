/**
 * invoice-checkout-issue
 * ────────────────────────────────────────────────────────────────────────────
 * Атомарная выписка счёта для сценария legal_entity / entrepreneur +
 * bank_transfer. Источник реквизитов — public.client_legal_details
 * (та же таблица, что используется в Настройки → Реквизиты для документов
 * и canonical-document-generate-strict).
 *
 * Что делает:
 *   1. Проверяет auth (JWT пользователя) и валидность оффера/продукта.
 *   2. Загружает запись из client_legal_details, проверяет ownership и
 *      что client_type ∈ (legal_entity, entrepreneur).
 *   3. Ресолвит CRM-роутинг оффера (pipeline_id + stage_on_pending).
 *   4. Создаёт запись в orders_v2:
 *        - payer_type — из client_type (legal_entity | entrepreneur)
 *        - status = 'draft'
 *        - pipeline_id / pipeline_stage_id = stage_on_pending
 *        - meta.checkout_kind = 'invoice'
 *        - meta.awaits_payment = true
 *        - meta.invoice_number
 *        - meta.legal_details_id
 *        - meta.purchase_snapshot — whitelisted snapshot (leg_/ent_ prefixes + банк)
 *        - meta.document_data._provenance.customer_legal_details_id — чтобы
 *          canonical-document-generate-strict взял именно эту запись.
 *   5. Вызывает canonical-document-generate-strict с флагом
 *      pre_payment_invoice: true — PDF-счёт формируется до оплаты.
 *
 * Обратная совместимость: тело запроса может нести `requisites_id` вместо
 * `legal_details_id` — legacy alias на переходный период (клиент шлёт только
 * legal_details_id).
 */
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveOfferRouting } from "../_shared/crm-routing.ts";
import {
  ComposableCheckoutError,
  resolveComposableCheckout,
} from "../_shared/resolve-composable-checkout.ts";
import { materializeComposableOrderGroup } from "../_shared/materialize-composable-order-group.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

interface IssueBody {
  product_id: string;
  offer_id: string;
  addon_offer_ids?: string[];
  legal_details_id?: string;
  requisites_id?: string; // legacy alias
}

/** Whitelist snapshot полей реквизитов для orders_v2.meta.purchase_snapshot. */
function buildRequisitesSnapshot(row: Record<string, unknown>) {
  const keys = [
    "client_type",
    // legal entity
    "leg_org_form",
    "leg_name",
    "leg_unp",
    "leg_address",
    "leg_address_structured",
    "leg_director_position",
    "leg_director_name",
    "leg_acts_on_basis",
    // entrepreneur
    "ent_name",
    "ent_unp",
    "ent_address",
    "ent_address_structured",
    "ent_acts_on_basis",
    // shared
    "bank_account",
    "bank_name",
    "bank_code",
    "phone",
    "email",
    // GRP registry stamp
    "grp_registration_date",
    "grp_status_name",
    "grp_tax_office_name",
    "grp_last_fetched_at",
  ] as const;
  const snap: Record<string, unknown> = {};
  for (const k of keys) if (row[k] !== undefined) snap[k] = row[k];
  return snap;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  const userClient: SupabaseClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin: SupabaseClient = createClient(url, service);

  const { data: authData } = await userClient.auth.getUser();
  const user = authData?.user;
  if (!user) return json({ error: "unauthorized" }, 401);

  let body: IssueBody;
  try {
    body = (await req.json()) as IssueBody;
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const legalDetailsId = body.legal_details_id || body.requisites_id;
  if (!body?.product_id || !body?.offer_id || !legalDetailsId) {
    return json({ error: "missing_fields" }, 400);
  }

  let composableQuote;
  try {
    composableQuote = await resolveComposableCheckout(admin, {
      parentOfferId: body.offer_id,
      addonOfferIds: body.addon_offer_ids ?? [],
    });
  } catch (error) {
    if (error instanceof ComposableCheckoutError) {
      return json({ error: error.code }, error.status);
    }
    return json({ error: "quote_failed" }, 500);
  }
  const primaryQuoteItem = composableQuote.items[0];
  if (primaryQuoteItem.product_id !== body.product_id) {
    return json({ error: "quote_product_mismatch" }, 400);
  }

  // 1. Профиль пользователя (profiles.user_id = auth.user.id).
  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) return json({ error: "profile_not_found" }, 404);

  // 2. Реквизиты из client_legal_details — принадлежат этому профилю?
  const { data: ld } = await admin
    .from("client_legal_details")
    .select("*")
    .eq("id", legalDetailsId)
    .maybeSingle();
  if (!ld || ld.profile_id !== profile.id) {
    return json({ error: "requisites_forbidden" }, 403);
  }
  if (ld.client_type !== "legal_entity" && ld.client_type !== "entrepreneur") {
    return json({ error: "requisites_wrong_type" }, 400);
  }

  // 3. Оффер + тариф + продукт.
  const { data: offer } = await admin
    .from("tariff_offers")
    .select("id, tariff_id, amount, is_active, meta")
    .eq("id", body.offer_id)
    .maybeSingle();
  if (!offer || !offer.is_active) return json({ error: "offer_not_available" }, 404);

  const { data: tariff } = await admin
    .from("tariffs")
    .select("id, name, code, product_id")
    .eq("id", offer.tariff_id)
    .maybeSingle();
  if (!tariff || tariff.product_id !== body.product_id) {
    return json({ error: "tariff_product_mismatch" }, 400);
  }

  const { data: product } = await admin
    .from("products_v2")
    .select("id, name, public_title, currency")
    .eq("id", body.product_id)
    .maybeSingle();
  if (!product) return json({ error: "product_not_found" }, 404);

  // 4. CRM routing.
  const routing = await resolveOfferRouting(admin, offer.id);
  const routingSnapshot = routing.ok ? routing.snapshot : null;

  // 5. Order number → invoice number.
  const { data: numData, error: numErr } = await admin.rpc(
    "generate_order_number",
  );
  if (numErr || !numData) {
    return json({ error: "generate_order_number_failed", message: numErr?.message }, 500);
  }
  const orderNumber = numData as string;
  const invoiceNumber = orderNumber;

  // 6. Create order.
  const payerType: "legal_entity" | "entrepreneur" =
    ld.client_type === "entrepreneur" ? "entrepreneur" : "legal_entity";

  const requisitesSnapshot = buildRequisitesSnapshot(ld);

  const orderMeta: Record<string, unknown> = {
    source: "invoice_checkout",
    checkout_kind: "invoice",
    awaits_payment: true,
    invoice_number: invoiceNumber,
    legal_details_id: ld.id,
    purchase_snapshot: {
      client_type: ld.client_type,
      requisites: requisitesSnapshot,
      captured_at: new Date().toISOString(),
    },
    composable_checkout: composableQuote,
    // Подсказка для canonical-document-generate-strict: он умеет брать
    // client_legal_details по _provenance.customer_legal_details_id.
    document_data: {
      service_name: composableQuote.items.map((item) =>
        [item.product_name, item.tariff_name].filter(Boolean).join(" — ")
      ).join("; "),
      unit: "комплект",
      quantity: 1,
      unit_price: composableQuote.total,
      amount: composableQuote.total,
      currency: composableQuote.currency,
      line_items: composableQuote.items,
      subtotal: composableQuote.subtotal,
      adjustment_amount: composableQuote.adjustment_amount,
      adjustment_reason: composableQuote.adjustment_reason,
      _provenance: {
        customer_legal_details_id: ld.id,
        source: "invoice_checkout",
        service_name_source: "composable_checkout",
      },
    },
  };
  if (routingSnapshot) orderMeta.crm_routing_snapshot = routingSnapshot;

  const orderInsert: Record<string, unknown> = {
    order_number: orderNumber,
    profile_id: profile.id,
    user_id: user.id,
    product_id: product.id,
    tariff_id: tariff.id,
    offer_id: offer.id,
    base_price: composableQuote.subtotal,
    final_price: composableQuote.total,
    currency: composableQuote.currency || product.currency || "BYN",
    status: "draft",
    payer_type: payerType,
    customer_email: profile.email,
    reconcile_source: "invoice_checkout",
    meta: orderMeta,
  };
  if (routingSnapshot) {
    orderInsert.pipeline_id = routingSnapshot.pipeline_id;
    orderInsert.pipeline_stage_id = routingSnapshot.stage_on_pending;
  }

  const { data: newOrder, error: orderErr } = await admin
    .from("orders_v2")
    .insert(orderInsert)
    .select("id, order_number")
    .single();
  if (orderErr || !newOrder) {
    return json({ error: "create_order_failed", message: orderErr?.message }, 500);
  }

  let orderGroupId: string | null = null;
  if (composableQuote.items.length > 1 || composableQuote.adjustment_amount !== 0) {
    try {
      orderGroupId = await materializeComposableOrderGroup(admin, {
        primaryOrderId: newOrder.id,
        quote: composableQuote,
        source: "invoice_checkout",
        idempotencyKey: `invoice:${newOrder.id}`,
      });
    } catch (error) {
      await admin.from("orders_v2").update({
        status: "cancelled",
        meta: {
          ...orderMeta,
          composable_materialization_error: (error as Error).message,
          manual_review_required: true,
        },
      }).eq("id", newOrder.id);
      return json({ error: "composable_order_materialization_failed" }, 500);
    }
  }

  // 7. Аудит.
  await admin.from("audit_logs").insert({
    actor_user_id: user.id,
    actor_type: "user",
    action: "invoice_checkout.order_created",
    meta: {
      order_id: newOrder.id,
      order_number: newOrder.order_number,
      invoice_number: invoiceNumber,
      offer_id: offer.id,
      product_id: product.id,
      legal_details_id: ld.id,
      payer_type: payerType,
      order_group_id: orderGroupId,
      quote_total: composableQuote.total,
      quote_items_count: composableQuote.items.length,
      routing_ok: routing.ok,
      routing_reason: routing.ok ? null : (routing as any).reason,
    },
  });

  // 8. PDF счёта — strict с флагом pre_payment_invoice.
  let pdfUrl: string | null = null;
  let documentId: string | null = null;
  try {
    const strictResp = await fetch(
      `${url}/functions/v1/canonical-document-generate-strict`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          apikey: anon,
        },
        body: JSON.stringify({
          order_id: newOrder.id,
          mode: "generate",
          pre_payment_invoice: true,
        }),
      },
    );
    const strictJson = await strictResp.json().catch(() => ({}));
    if (strictResp.ok) {
      pdfUrl = strictJson.pdf_url ?? strictJson.file_url ?? strictJson.download_url ?? null;
      documentId = strictJson.document_id ?? null;
    } else {
      console.error("[invoice-checkout-issue] strict failed", strictResp.status, strictJson);
      await admin.from("audit_logs").insert({
        actor_user_id: user.id,
        actor_type: "user",
        action: "invoice_checkout.document_generate_failed",
        meta: {
          order_id: newOrder.id,
          status: strictResp.status,
          response: strictJson,
        },
      });
    }
  } catch (e) {
    console.error("[invoice-checkout-issue] strict exception", e);
  }

  // Достаём document_number из ai_generated_documents (это реальный номер счёта,
  // например 0407/4 — отличается от orderNumber ORD-26-00254).
  let documentNumber: string | null = null;
  let documentIssuedAt: string | null = null;
  if (documentId) {
    const { data: docRow } = await admin
      .from("ai_generated_documents")
      .select("document_number, created_at")
      .eq("id", documentId)
      .maybeSingle();
    documentNumber = docRow?.document_number ?? null;
    documentIssuedAt = docRow?.created_at ?? null;
  }


  // 9. Отправка счёта на email/telegram — через canonical-document-send.
  // Fire-and-forget: SMTP-отправка PDF-вложения может тянуться до 2 минут
  // (Yandex тайм-аут после DATA), что раньше подвешивало диалог «Выписываем
  // счёт…». Клиенту важен только факт формирования счёта; результат отправки
  // писем/Telegram фиксируется в audit_logs асинхронно.
  if (documentId) {
    const sendPromise = (async () => {
      try {
        const sendResp = await fetch(
          `${url}/functions/v1/canonical-document-send`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: authHeader,
              apikey: anon,
            },
            body: JSON.stringify({
              document_id: documentId,
              send_email: true,
              send_telegram: true,
            }),
          },
        );
        const sendJson = await sendResp.json().catch(() => ({}));
        if (!sendResp.ok) {
          console.error("[invoice-checkout-issue] send failed", sendResp.status, sendJson);
          await admin.from("audit_logs").insert({
            actor_user_id: user.id,
            actor_type: "user",
            action: "invoice_checkout.document_send_failed",
            meta: { order_id: newOrder.id, document_id: documentId, status: sendResp.status, response: sendJson },
          });
        } else {
          await admin.from("audit_logs").insert({
            actor_user_id: user.id,
            actor_type: "user",
            action: "invoice_checkout.document_send_completed",
            meta: { order_id: newOrder.id, document_id: documentId, results: sendJson?.results ?? null },
          });
        }
      } catch (e) {
        console.error("[invoice-checkout-issue] send exception", e);
      }
    })();
    // @ts-ignore — EdgeRuntime доступен в Deno Deploy / Supabase Edge Runtime.
    if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any)?.waitUntil) {
      // @ts-ignore
      (EdgeRuntime as any).waitUntil(sendPromise);
    }
    // Иначе просто не ждём — ответ уходит клиенту сразу.
  }

  // Email/Telegram отправляются в фоне. В ответе помечаем как «в процессе»,
  // клиент показывает нейтральный текст без обещания доставки.
  const emailSent = false;
  const telegramSent = false;


  return json({
    order_id: newOrder.id,
    order_group_id: orderGroupId,
    order_number: newOrder.order_number,
    invoice_number: invoiceNumber,
    document_id: documentId,
    document_number: documentNumber,
    document_issued_at: documentIssuedAt,
    pdf_url: pdfUrl,
    email_sent: emailSent,
    telegram_sent: telegramSent,
  });
});
