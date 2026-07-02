/**
 * invoice-checkout-issue
 * ────────────────────────────────────────────────────────────────────────────
 * Атомарная выписка счёта для сценария legal_entity + bank_transfer.
 *
 * Что делает:
 *   1. Проверяет auth (JWT пользователя) и валидность оффера/продукта/реквизитов.
 *   2. Ресолвит CRM-роутинг оффера (pipeline_id + stage_on_pending) через
 *      _shared/crm-routing.ts.
 *   3. Создаёт запись в orders_v2:
 *        - payer_type = 'legal_entity'
 *        - status = 'draft'
 *        - pipeline_id / pipeline_stage_id = stage_on_pending
 *        - meta.checkout_kind = 'invoice'
 *        - meta.awaits_payment = true
 *        - meta.requisites_id = <ссылка на legal_entities_requisites>
 *        - meta.purchase_snapshot = snapshot реквизитов
 *   4. Присваивает order.meta.invoice_number (совпадает с order_number для
 *      простоты сверки от банка).
 *   5. Вызывает canonical-document-generate-strict с флагом
 *      pre_payment_invoice: true — PDF-счёт формируется до оплаты.
 *   6. Возвращает { order_id, invoice_number, pdf_url, email_sent, telegram_sent }.
 *
 * Сверка входящих банковских платежей и авто-перевод в stage_on_paid — в
 * отдельной задаче (см. roadmap).
 */
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveOfferRouting } from "../_shared/crm-routing.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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
  requisites_id: string;
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
  if (!body?.product_id || !body?.offer_id || !body?.requisites_id) {
    return json({ error: "missing_fields" }, 400);
  }

  // 1. Профиль пользователя
  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return json({ error: "profile_not_found" }, 404);

  // 2. Реквизиты — принадлежат этому пользователю?
  const { data: req_row } = await admin
    .from("legal_entities_requisites")
    .select("id, profile_id, subject_type, data, is_default")
    .eq("id", body.requisites_id)
    .maybeSingle();
  if (!req_row || req_row.profile_id !== profile.id) {
    return json({ error: "requisites_forbidden" }, 403);
  }
  if (req_row.subject_type !== "legal_entity" &&
      req_row.subject_type !== "entrepreneur") {
    return json({ error: "requisites_wrong_type" }, 400);
  }

  // 3. Оффер + тариф + продукт
  const { data: offer } = await admin
    .from("tariff_offers")
    .select("id, tariff_id, base_price, final_price, is_active, meta")
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
    .from("products")
    .select("id, name, public_title, currency")
    .eq("id", body.product_id)
    .maybeSingle();
  if (!product) return json({ error: "product_not_found" }, 404);

  // 4. CRM routing
  const routing = await resolveOfferRouting(admin, offer.id);
  const routingSnapshot = routing.ok ? routing.snapshot : null;

  // 5. Order number
  const { data: numData, error: numErr } = await admin.rpc(
    "generate_order_number",
  );
  if (numErr || !numData) {
    return json({ error: "generate_order_number_failed", message: numErr?.message }, 500);
  }
  const orderNumber = numData as string;
  const invoiceNumber = orderNumber; // используем order_number как № счёта

  // 6. Create order
  const orderMeta: Record<string, unknown> = {
    source: "invoice_checkout",
    checkout_kind: "invoice",
    awaits_payment: true,
    invoice_number: invoiceNumber,
    requisites_id: req_row.id,
    purchase_snapshot: {
      requisites: req_row.data,
      subject_type: req_row.subject_type,
      captured_at: new Date().toISOString(),
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
    base_price: offer.base_price ?? 0,
    final_price: offer.final_price ?? 0,
    currency: product.currency || "BYN",
    status: "draft",
    payer_type: "legal_entity",
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

  // 7. Аудит
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
      requisites_id: req_row.id,
      routing_ok: routing.ok,
      routing_reason: routing.ok ? null : (routing as any).reason,
    },
  });

  // 8. Сгенерировать PDF счёта — вызываем strict с флагом pre_payment_invoice.
  //    Передаём JWT пользователя, чтобы strict видел owner-а заказа.
  let pdfUrl: string | null = null;
  let emailSent = false;
  let telegramSent = false;
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
          pre_payment_invoice: true,
          send_email: true,
          send_telegram: true,
        }),
      },
    );
    const strictJson = await strictResp.json().catch(() => ({}));
    if (strictResp.ok) {
      pdfUrl = strictJson.pdf_url ?? strictJson.file_url ?? null;
      emailSent = !!strictJson.email_sent;
      telegramSent = !!strictJson.telegram_sent;
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

  return json({
    order_id: newOrder.id,
    order_number: newOrder.order_number,
    invoice_number: invoiceNumber,
    pdf_url: pdfUrl,
    email_sent: emailSent,
    telegram_sent: telegramSent,
  });
});
