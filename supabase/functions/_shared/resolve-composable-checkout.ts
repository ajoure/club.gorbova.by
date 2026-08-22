import {
  buildComposableQuote,
  type QuoteSourceItem,
} from "./composable-checkout.ts";

export interface ResolveComposableCheckoutInput {
  parentOfferId: string;
  addonOfferIds?: string[];
  adjustmentAmount?: number;
  adjustmentReason?: string | null;
}

export interface ResolvedComposableCheckout {
  currency: string;
  items: ReturnType<typeof buildComposableQuote>["items"];
  subtotal: number;
  adjustment_amount: number;
  adjustment_reason: string | null;
  total: number;
  available_addons: Array<Record<string, unknown>>;
  selected_addon_offer_ids: string[];
}

export class ComposableCheckoutError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

/**
 * Canonical server-side resolver shared by card, invoice and RR checkout.
 * Browser-supplied names/prices are never trusted.
 */
export async function resolveComposableCheckout(
  admin: any,
  input: ResolveComposableCheckoutInput,
): Promise<ResolvedComposableCheckout> {
  const { data: parentOffer, error: parentError } = await admin
    .from("tariff_offers")
    .select(
      "id,amount,is_active,tariff:tariffs!tariff_offers_tariff_id_fkey(id,name,product:products_v2!tariffs_product_id_fkey(id,name,currency,is_active))",
    )
    .eq("id", input.parentOfferId)
    .maybeSingle();
  if (parentError) throw new ComposableCheckoutError("parent_offer_lookup_failed", 500);
  if (!parentOffer?.is_active || !parentOffer?.tariff?.product?.is_active) {
    throw new ComposableCheckoutError("parent_offer_unavailable", 404);
  }

  const { data: addonRules, error: addonError } = await admin
    .from("offer_addons")
    .select(
      "id,addon_product_id,addon_tariff_id,addon_offer_id,pricing_mode,fixed_amount,discount_percent,is_required,is_default_selected,allow_repurchase_after_expiry,access_delivery_mode,access_opens_at,access_duration_days,sort_order,visible_from,visible_to,addon_product:products_v2!offer_addons_addon_product_id_fkey(id,name,currency,is_active),addon_tariff:tariffs!offer_addons_addon_tariff_id_fkey(id,name,is_active),addon_offer:tariff_offers!offer_addons_addon_offer_id_fkey(id,amount,is_active)",
    )
    .eq("parent_offer_id", input.parentOfferId)
    .eq("is_active", true)
    .order("sort_order");
  if (addonError) throw new ComposableCheckoutError("addon_configuration_unavailable", 500);

  const now = Date.now();
  const available = (addonRules ?? []).filter((rule: any) =>
    (!rule.visible_from || Date.parse(rule.visible_from) <= now) &&
    (!rule.visible_to || Date.parse(rule.visible_to) >= now) &&
    rule.addon_product?.is_active === true &&
    rule.addon_tariff?.is_active === true &&
    rule.addon_offer?.is_active === true
  );
  const requested = new Set(input.addonOfferIds ?? []);
  if (requested.size !== (input.addonOfferIds ?? []).length) {
    throw new ComposableCheckoutError("duplicate_addon_offer");
  }
  for (const id of requested) {
    if (!available.some((rule: any) => rule.addon_offer_id === id)) {
      throw new ComposableCheckoutError("addon_not_allowed");
    }
  }

  const selected = available.filter((rule: any) =>
    rule.is_required || requested.has(rule.addon_offer_id)
  );
  for (const rule of selected) {
    if (!["immediate", "fixed_date", "manual"].includes(rule.access_delivery_mode)) {
      throw new ComposableCheckoutError("addon_access_delivery_mode_missing", 500);
    }
    if (rule.access_delivery_mode === "fixed_date" && !rule.access_opens_at) {
      throw new ComposableCheckoutError("addon_access_opening_date_missing", 500);
    }
  }
  const parentTariff: any = parentOffer.tariff;
  const currency = String(parentTariff.product.currency ?? "BYN").toUpperCase();
  if (
    selected.some((rule: any) =>
      String(rule.addon_product?.currency ?? currency).toUpperCase() !== currency
    )
  ) {
    throw new ComposableCheckoutError("mixed_currency_not_supported");
  }

  const source: QuoteSourceItem[] = [{
    role: "primary",
    product_id: parentTariff.product.id,
    product_name: parentTariff.product.name,
    tariff_id: parentTariff.id,
    tariff_name: parentTariff.name,
    offer_id: parentOffer.id,
    list_amount: Number(parentOffer.amount),
    sort_order: 0,
  }, ...selected.map((rule: any) => ({
    role: "addon" as const,
    parent_offer_id: parentOffer.id,
    product_id: rule.addon_product_id,
    product_name: rule.addon_product.name,
    tariff_id: rule.addon_tariff_id,
    tariff_name: rule.addon_tariff.name,
    offer_id: rule.addon_offer_id,
    list_amount: Number(rule.addon_offer.amount),
    pricing_mode: rule.pricing_mode,
    fixed_amount: rule.fixed_amount == null ? null : Number(rule.fixed_amount),
    discount_percent:
      rule.discount_percent == null ? null : Number(rule.discount_percent),
    access_delivery_mode: rule.access_delivery_mode,
    access_opens_at: rule.access_opens_at ?? null,
    access_duration_days:
      rule.access_duration_days == null ? null : Number(rule.access_duration_days),
    sort_order: rule.sort_order,
  }))];

  let quote: ReturnType<typeof buildComposableQuote>;
  try {
    quote = buildComposableQuote(source, Number(input.adjustmentAmount ?? 0));
  } catch (error) {
    throw new ComposableCheckoutError(
      error instanceof Error ? error.message : "quote_failed",
    );
  }
  const reason = String(input.adjustmentReason ?? "").trim();
  if (quote.adjustment_amount !== 0 && !reason) {
    throw new ComposableCheckoutError("adjustment_reason_required");
  }

  return {
    currency,
    ...quote,
    adjustment_reason: quote.adjustment_amount === 0 ? null : reason,
    selected_addon_offer_ids: selected
      .filter((rule: any) => rule.is_required || requested.has(rule.addon_offer_id))
      .map((rule: any) => rule.addon_offer_id),
    available_addons: available.map((rule: any) => ({
      addon_product_id: rule.addon_product_id,
      addon_product_name: rule.addon_product.name,
      addon_tariff_id: rule.addon_tariff_id,
      addon_tariff_name: rule.addon_tariff.name,
      addon_offer_id: rule.addon_offer_id,
      list_amount: Number(rule.addon_offer.amount),
      pricing_mode: rule.pricing_mode,
      fixed_amount: rule.fixed_amount,
      discount_percent: rule.discount_percent,
      is_required: rule.is_required,
      is_default_selected: rule.is_default_selected,
      allow_repurchase_after_expiry: rule.allow_repurchase_after_expiry,
      access_delivery_mode: rule.access_delivery_mode,
      access_opens_at: rule.access_opens_at ?? null,
      access_duration_days:
        rule.access_duration_days == null ? null : Number(rule.access_duration_days),
    })),
  };
}
