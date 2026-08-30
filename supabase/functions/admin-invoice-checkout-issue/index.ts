/**
 * admin-invoice-checkout-issue
 * ────────────────────────────────────────────────────────────────────────────
 * Админский аналог `invoice-checkout-issue`. Отличия:
 *  • auth = JWT с каноническим доступом payments:edit;
 *  • целевой профиль передаётся полем `target_user_id`;
 *  • `legal_details_id` проверяется на принадлежность целевому профилю
 *    (не JWT-пользователю);
 *  • addon_offer_ids идут в canonical resolveComposableCheckout;
 *  • PDF-счёт формируется через canonical-document-generate-strict;
 *  • после успешной генерации запускается каноническая доставка на email и
 *    Telegram; итог каналов читается через invoice-delivery-status.
 *
 * Никаких новых таблиц: пишем в orders_v2 + order_groups + order_group_items
 * через shared materializeComposableOrderGroup.
 */
import {
  createClient,
  SupabaseClient,
} from "npm:@supabase/supabase-js@2";
import { resolveOfferRouting } from "../_shared/crm-routing.ts";
import {
  ComposableCheckoutError,
  resolveComposableCheckout,
  type ResolvedComposableCheckout,
} from "../_shared/resolve-composable-checkout.ts";
import { allocateComposablePayableTotal } from "../_shared/composable-checkout.ts";
import { materializeComposableOrderGroup } from "../_shared/materialize-composable-order-group.ts";
import { buildPurchaseCompositionTitle } from "../_shared/purchase-composition-title.ts";
import { requirePaymentsEdit } from "../_shared/admin-section-auth.ts";
import { resolveSalesManagerForCreation, SalesManagerSelectionError } from "../_shared/sales-manager-attribution.ts";

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
  target_user_id: string;
  product_id: string;
  offer_id: string;
  addon_offer_ids?: string[];
  legal_details_id?: string | null;
  payer_type?: "legal_entity" | "entrepreneur" | "individual";
  adjustment_amount?: number;
  adjustment_reason?: string | null;
  responsible_user_id?: string | null;
}

function buildRequisitesSnapshot(row: Record<string, unknown>) {
  const keys = [
    "client_type",
    "leg_org_form", "leg_name", "leg_unp", "leg_address", "leg_address_structured",
    "leg_director_position", "leg_director_name", "leg_acts_on_basis",
    "ent_name", "ent_unp", "ent_address", "ent_address_structured", "ent_acts_on_basis",
    "bank_account", "bank_name", "bank_code",
    "phone", "email",
    "grp_registration_date", "grp_status_name", "grp_tax_office_name", "grp_last_fetched_at",
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
  const admin: SupabaseClient = createClient(url, service);
  const access = await requirePaymentsEdit(req, admin);
  if (!access.ok) return json({ error: access.error }, access.status);
  const actor = access.actor;

  let body: IssueBody;
  try {
    body = (await req.json()) as IssueBody;
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  if (!body?.target_user_id || !body?.product_id || !body?.offer_id) {
    return json({ error: "missing_fields" }, 400);
  }
  let responsibleUserId: string;
  try {
    responsibleUserId = await resolveSalesManagerForCreation(admin, actor.id, body.responsible_user_id);
  } catch (error) {
    if (error instanceof SalesManagerSelectionError) return json({ error: error.code }, error.status);
    return json({ error: "sales_manager_rbac_check_failed" }, 500);
  }

  // Target profile
  const { data: targetProfile } = await admin
    .from("profiles")
    .select("id, user_id, email, full_name")
    .eq("user_id", body.target_user_id)
    .maybeSingle();
  if (!targetProfile) return json({ error: "target_profile_not_found" }, 404);

  // Legal details (optional for individual payer)
  let ld: any = null;
  const wantLegal = body.payer_type === "legal_entity" || body.payer_type === "entrepreneur";
  if (wantLegal) {
    if (!body.legal_details_id) return json({ error: "legal_details_required" }, 400);
    const { data } = await admin
      .from("client_legal_details")
      .select("*")
      .eq("id", body.legal_details_id)
      .maybeSingle();
    if (!data) return json({ error: "legal_details_not_found" }, 404);
    if (data.profile_id !== targetProfile.id) {
      return json({ error: "legal_details_profile_mismatch" }, 403);
    }
    if (data.client_type !== "legal_entity" && data.client_type !== "entrepreneur") {
      return json({ error: "legal_details_wrong_type" }, 400);
    }
    ld = data;
  }

  // Composable quote. The offer configuration remains the source of list
  // prices; an administrator can only pass a documented adjustment to the
  // resulting total. Allocate it over items so orders, the group snapshot and
  // the invoice line all carry one identical payable total.
  const requestedAdjustment = Number(body.adjustment_amount ?? 0);
  const requestedReason = String(body.adjustment_reason ?? "").trim();
  if (!Number.isFinite(requestedAdjustment) || Math.round(requestedAdjustment * 100) !== requestedAdjustment * 100) {
    return json({ error: "invalid_adjustment_amount" }, 400);
  }
  if (requestedAdjustment !== 0 && !requestedReason) {
    return json({ error: "adjustment_reason_required" }, 400);
  }

  let composableQuote: ResolvedComposableCheckout;
  try {
    const baseQuote = await resolveComposableCheckout(admin, {
      parentOfferId: body.offer_id,
      addonOfferIds: body.addon_offer_ids ?? [],
    });
    const requestedTotal = Math.round((baseQuote.subtotal + requestedAdjustment) * 100) / 100;
    if (requestedTotal <= 0) return json({ error: "invalid_adjustment_amount" }, 400);
    if (requestedAdjustment === 0) {
      composableQuote = baseQuote;
    } else {
      const allocated = allocateComposablePayableTotal(
        baseQuote,
        requestedTotal,
        requestedReason,
      );
      composableQuote = {
        ...baseQuote,
        ...allocated,
        adjustment_reason: requestedReason,
      };
    }
  } catch (error) {
    if (error instanceof ComposableCheckoutError) return json({ error: error.code }, error.status);
    return json({ error: "quote_failed" }, 500);
  }
  const primary = composableQuote.items[0];
  if (primary.product_id !== body.product_id) {
    return json({ error: "quote_product_mismatch" }, 400);
  }

  const { data: offer } = await admin
    .from("tariff_offers")
    .select("id, tariff_id, amount, is_active, offer_type, meta")
    .eq("id", body.offer_id)
    .maybeSingle();
  if (!offer || !offer.is_active) return json({ error: "offer_not_available" }, 404);
  if ((offer as any).offer_type !== "invoice") {
    return json({ error: "offer_type_not_invoice" }, 400);
  }

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

  const routing = await resolveOfferRouting(admin, offer.id);
  const routingSnapshot = routing.ok ? routing.snapshot : null;

  const { data: numData, error: numErr } = await admin.rpc("generate_order_number");
  if (numErr || !numData) return json({ error: "generate_order_number_failed", message: numErr?.message }, 500);
  const orderNumber = numData as string;
  const invoiceNumber = orderNumber;

  const payerType: "legal_entity" | "entrepreneur" | "individual" =
    ld?.client_type === "entrepreneur"
      ? "entrepreneur"
      : ld?.client_type === "legal_entity"
        ? "legal_entity"
        : "individual";

  const items = composableQuote.items ?? [];
  const primaryItem = items.find((i: any) => i?.role === "primary") ?? items[0];
  const addons = items
    .filter((i: any) => i !== primaryItem)
    .sort((a: any, b: any) => Number(a?.sort_order ?? 0) - Number(b?.sort_order ?? 0));
  const serviceName = buildPurchaseCompositionTitle({
    primary: { product_name: primaryItem?.product_name, tariff_name: primaryItem?.tariff_name },
    addons: addons.map((a: any) => ({ product_name: a?.product_name })),
  });

  const orderMeta: Record<string, unknown> = {
    source: "admin_invoice_checkout",
    checkout_kind: "invoice",
    awaits_payment: true,
    invoice_number: invoiceNumber,
    legal_details_id: ld?.id ?? null,
    admin_actor_user_id: actor.id,
    purchase_snapshot: {
      client_type: ld?.client_type ?? "individual",
      requisites: ld ? buildRequisitesSnapshot(ld) : null,
      captured_at: new Date().toISOString(),
    },
    composable_checkout: composableQuote,
    document_data: {
      service_name: serviceName,
      unit: "доступ",
      quantity: 1,
      unit_price: composableQuote.total,
      amount: composableQuote.total,
      currency: composableQuote.currency,
      line_items: composableQuote.items,
      subtotal: composableQuote.subtotal,
      adjustment_amount: composableQuote.adjustment_amount,
      adjustment_reason: composableQuote.adjustment_reason ?? body.adjustment_reason ?? null,
      _provenance: {
        customer_legal_details_id: ld?.id ?? null,
        source: "admin_invoice_checkout",
        service_name_source: "composable_checkout",
      },
    },
  };
  if (routingSnapshot) orderMeta.crm_routing_snapshot = routingSnapshot;

  const orderInsert: Record<string, unknown> = {
    order_number: orderNumber,
    profile_id: targetProfile.id,
    user_id: targetProfile.user_id,
    responsible_user_id: responsibleUserId,
    product_id: product.id,
    tariff_id: tariff.id,
    offer_id: offer.id,
    base_price: composableQuote.subtotal,
    final_price: composableQuote.total,
    currency: composableQuote.currency || product.currency || "BYN",
    status: "draft",
    payer_type: payerType,
    customer_email: targetProfile.email,
    reconcile_source: "admin_invoice_checkout",
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
        source: "admin_invoice_checkout",
        idempotencyKey: `admin-invoice:${newOrder.id}`,
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

  await admin.from("audit_logs").insert({
    actor_user_id: actor.id,
    actor_type: "user",
    target_user_id: targetProfile.user_id,
    action: "admin_invoice_checkout.order_created",
    meta: {
      order_id: newOrder.id,
      order_number: newOrder.order_number,
      invoice_number: invoiceNumber,
      offer_id: offer.id,
      product_id: product.id,
      legal_details_id: ld?.id ?? null,
      payer_type: payerType,
      order_group_id: orderGroupId,
      quote_total: composableQuote.total,
      adjustment_amount: composableQuote.adjustment_amount,
      adjustment_reason: composableQuote.adjustment_reason,
      quote_items_count: composableQuote.items.length,
      routing_ok: routing.ok,
    },
  });

  // Generate PDF (strict).
  let pdfUrl: string | null = null;
  let documentId: string | null = null;
  let documentNumber: string | null = null;
  let documentIssuedAt: string | null = null;
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
      if (documentId) {
        const { data: docRow } = await admin
          .from("ai_generated_documents")
          .select("document_number, created_at")
          .eq("id", documentId)
          .maybeSingle();
        documentNumber = docRow?.document_number ?? null;
        documentIssuedAt = docRow?.created_at ?? null;
      }
    } else {
      console.error("[admin-invoice-checkout-issue] strict failed", strictResp.status, strictJson);
      await admin.from("audit_logs").insert({
        actor_user_id: actor.id,
        actor_type: "user",
        target_user_id: targetProfile.user_id,
        action: "admin_invoice_checkout.document_generate_failed",
        entity_type: "order",
        entity_id: newOrder.id,
        meta: {
          order_id: newOrder.id,
          order_number: newOrder.order_number,
          offer_id: offer.id,
          status: strictResp.status,
          response: strictJson,
          via: "canonical-document-generate-strict",
        },
      });
    }
  } catch (e) {
    console.error("[admin-invoice-checkout-issue] strict exception", e);
    await admin.from("audit_logs").insert({
      actor_user_id: actor.id,
      actor_type: "user",
      target_user_id: targetProfile.user_id,
      action: "admin_invoice_checkout.document_generate_failed",
      entity_type: "order",
      entity_id: newOrder.id,
      meta: {
        order_id: newOrder.id,
        order_number: newOrder.order_number,
        offer_id: offer.id,
        error: e instanceof Error ? e.message : String(e),
        via: "canonical-document-generate-strict",
      },
    });
  }

  // Запускаем ту же каноническую доставку, что и в пользовательском
  // invoice-checkout-issue. Раньше административный сценарий возвращал
  // document_id сразу после генерации PDF, но canonical-document-send вообще
  // не вызывал — UI закономерно завершал polling статусом
  // delivery_not_started для обоих каналов.
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
        await admin.from("audit_logs").insert({
          actor_user_id: actor.id,
          actor_type: "user",
          action: sendResp.ok
            ? "admin_invoice_checkout.document_send_completed"
            : "admin_invoice_checkout.document_send_failed",
          entity_type: "ai_generated_document",
          entity_id: documentId,
          meta: {
            order_id: newOrder.id,
            document_id: documentId,
            status: sendResp.status,
            ...(sendResp.ok
              ? { results: sendJson?.results ?? null }
              : { response: sendJson }),
          },
        });
        if (!sendResp.ok) {
          console.error(
            "[admin-invoice-checkout-issue] send failed",
            sendResp.status,
            sendJson,
          );
        }
      } catch (e) {
        console.error("[admin-invoice-checkout-issue] send exception", e);
        await admin.from("audit_logs").insert({
          actor_user_id: actor.id,
          actor_type: "user",
          action: "admin_invoice_checkout.document_send_failed",
          entity_type: "ai_generated_document",
          entity_id: documentId,
          meta: {
            order_id: newOrder.id,
            document_id: documentId,
            error: e instanceof Error ? e.message : String(e),
          },
        });
      }
    })();

    // Не держим UI открытым во время SMTP/Telegram I/O, но гарантируем, что
    // Edge Runtime не завершит обработчик до окончания фоновой доставки.
    // Локальный fallback ждёт promise и делает поведение тестируемым.
    // @ts-ignore — EdgeRuntime предоставляется Supabase Edge Runtime.
    if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any)?.waitUntil) {
      // @ts-ignore
      (EdgeRuntime as any).waitUntil(sendPromise);
    } else {
      await sendPromise;
    }
  }

  return json({
    order_id: newOrder.id,
    order_group_id: orderGroupId,
    order_number: newOrder.order_number,
    invoice_number: invoiceNumber,
    document_id: documentId,
    document_number: documentNumber,
    document_issued_at: documentIssuedAt,
    pdf_url: pdfUrl,
    payer_type: payerType,
    total: composableQuote.total,
    currency: composableQuote.currency,
  });
});
