/**
 * purchaseDocumentRules — единый контракт правил «Сформировать документ» и
 * «Скачать чек bePaid» в /purchases.
 *
 * Backend mirror: supabase/functions/_shared/purchase-document-rules.ts.
 * Любая правка ОБЯЗАТЕЛЬНО зеркалится в backend файл с теми же test-cases.
 *
 * См. .lovable/plan.md → PATCH-A.
 */

import { resolveDocumentScenario, type PayerType } from "@/utils/resolveDocumentScenario";
import type { PaymentChannel } from "@/utils/derivePaymentChannel";

// ---------------------------------------------------------------------------
// 1. Резолв offer_id заказа (id-first, без эвристик)
// ---------------------------------------------------------------------------

export interface OrderLikeForOffer {
  offer_id?: string | null;
  meta?: Record<string, any> | null;
}

export function getOrderOfferId(order: OrderLikeForOffer | null | undefined): string | null {
  if (!order) return null;
  const m = order.meta || {};
  return (
    order.offer_id ||
    m?.offer_id ||
    m?.crm_routing_snapshot?.offer_id ||
    m?.document_data?._provenance?.offer_id ||
    null
  );
}

// ---------------------------------------------------------------------------
// 2. resolveOfferForOrder — берём offer_id заказа; fallback только если у
//    тарифа РОВНО один активный оффер.
// ---------------------------------------------------------------------------

export interface TariffOfferLite {
  id: string;
  tariff_id: string | null;
  is_active: boolean | null;
  meta: Record<string, any> | null;
}

export type OfferResolveSource =
  | "order_offer"
  | "single_active_tariff_offer"
  | "none";

export type OfferResolveReason =
  | "no_offer_id_no_tariff_id"
  | "offer_not_found"
  | "multiple_or_zero_active_offers"
  | "ok";

export interface ResolvedOffer {
  offer: TariffOfferLite | null;
  source: OfferResolveSource;
  reason: OfferResolveReason;
}

export interface ResolveOfferInput {
  order: OrderLikeForOffer & { tariff_id?: string | null };
  /** Все офферы по тарифу заказа (готовая выборка). */
  tariffOffers: TariffOfferLite[];
}

export function resolveOfferForOrder({ order, tariffOffers }: ResolveOfferInput): ResolvedOffer {
  const offerId = getOrderOfferId(order);
  if (offerId) {
    const found = tariffOffers.find((o) => o.id === offerId) || null;
    if (found) return { offer: found, source: "order_offer", reason: "ok" };
    return { offer: null, source: "none", reason: "offer_not_found" };
  }
  const tariffId = order.tariff_id || null;
  if (!tariffId) return { offer: null, source: "none", reason: "no_offer_id_no_tariff_id" };
  const active = tariffOffers.filter((o) => o.tariff_id === tariffId && o.is_active === true);
  if (active.length === 1) {
    return { offer: active[0], source: "single_active_tariff_offer", reason: "ok" };
  }
  return { offer: null, source: "none", reason: "multiple_or_zero_active_offers" };
}

// ---------------------------------------------------------------------------
// 3. hasRealSucceededPayment — только реальные эквайринговые платежи.
//    discovery payments_v2.provider: bepaid, admin, admin_test (sandbox).
// ---------------------------------------------------------------------------

const EXCLUDED_PROVIDERS = new Set([
  "admin",
  "admin_test",
  "admin_test_direct",
  "manual",
  "virtual",
  "internal_test",
]);

export interface PaymentLike {
  status?: string | null;
  provider?: string | null;
  receipt_url?: string | null;
  provider_response?: { transaction?: { receipt_url?: string | null } | null } | null;
}

export function isRealPayment(p: PaymentLike | null | undefined): boolean {
  if (!p) return false;
  if (String(p.status).toLowerCase() !== "succeeded") return false;
  const provider = String(p.provider || "").toLowerCase();
  if (!provider) return false;
  return !EXCLUDED_PROVIDERS.has(provider);
}

export function hasRealSucceededPayment(payments: PaymentLike[] | null | undefined): boolean {
  if (!Array.isArray(payments)) return false;
  return payments.some(isRealPayment);
}

// ---------------------------------------------------------------------------
// 4. getValidReceiptUrl — валидный непустой URL, иначе null.
// ---------------------------------------------------------------------------

export function getValidReceiptUrl(p: PaymentLike | null | undefined): string | null {
  if (!p) return null;
  const a = (p.receipt_url || "").trim();
  if (a) return a;
  const b = (p.provider_response?.transaction?.receipt_url || "").trim();
  return b || null;
}

// ---------------------------------------------------------------------------
// 5. isOfferDocumentEnabled
// ---------------------------------------------------------------------------

export type OfferDocStatus =
  | { enabled: true; template_id: string; source: "scenario" | "defaults"; reason: "ok" }
  | {
      enabled: false;
      template_id: null;
      source: "none";
      reason: "no_offer" | "no_template" | "disabled";
    };

export interface DocCtx {
  payerType: PayerType;
  paymentChannel: PaymentChannel | null;
}

export function isOfferDocumentEnabled(
  offerMeta: Record<string, any> | null | undefined,
  ctx: DocCtx,
): OfferDocStatus {
  if (!offerMeta) {
    return { enabled: false, template_id: null, source: "none", reason: "no_offer" };
  }
  // Сценарий имеет приоритет.
  const scenario = resolveDocumentScenario(offerMeta as any, ctx.paymentChannel, ctx.payerType);
  if (scenario.source === "scenario" && scenario.template_id) {
    return { enabled: true, template_id: scenario.template_id, source: "scenario", reason: "ok" };
  }
  // Defaults: документ включён только если явно generate_act===true И template_id непустой.
  const defs = offerMeta.document_defaults || null;
  const generateAct = defs?.generate_act === true;
  const defTemplateId = (defs?.template_id as string | null) || null;
  if (generateAct && defTemplateId) {
    return { enabled: true, template_id: defTemplateId, source: "defaults", reason: "ok" };
  }
  if (generateAct && !defTemplateId) {
    return { enabled: false, template_id: null, source: "none", reason: "no_template" };
  }
  return { enabled: false, template_id: null, source: "none", reason: "disabled" };
}

// ---------------------------------------------------------------------------
// 6. canGenerateDocument — финальная композиция.
// ---------------------------------------------------------------------------

export interface CanGenerateInput {
  order: OrderLikeForOffer & { tariff_id?: string | null };
  payments: PaymentLike[] | null | undefined;
  tariffOffers: TariffOfferLite[];
  ctx: DocCtx;
}

export interface CanGenerateResult {
  canGenerate: boolean;
  hasPayment: boolean;
  offer: ResolvedOffer;
  doc: OfferDocStatus;
}

export function canGenerateDocument(input: CanGenerateInput): CanGenerateResult {
  const hasPayment = hasRealSucceededPayment(input.payments);
  const offer = resolveOfferForOrder({ order: input.order, tariffOffers: input.tariffOffers });
  const doc = offer.offer
    ? isOfferDocumentEnabled(offer.offer.meta, input.ctx)
    : ({ enabled: false, template_id: null, source: "none", reason: "no_offer" } as OfferDocStatus);
  return {
    canGenerate: hasPayment && doc.enabled,
    hasPayment,
    offer,
    doc,
  };
}
