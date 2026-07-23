export type PricingMode = "offer_price" | "fixed_price" | "percent_discount" | "free";

export interface QuoteSourceItem {
  role: "primary" | "addon";
  product_id: string;
  product_name: string;
  tariff_id: string;
  tariff_name: string;
  offer_id: string;
  list_amount: number;
  pricing_mode?: PricingMode;
  fixed_amount?: number | null;
  discount_percent?: number | null;
  sort_order?: number;
}

export interface QuoteItem extends QuoteSourceItem {
  discount_amount: number;
  final_amount: number;
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function priceQuoteItem(item: QuoteSourceItem): QuoteItem {
  const list = money(Number(item.list_amount));
  if (!Number.isFinite(list) || list < 0) throw new Error("invalid_list_amount");

  let final = list;
  switch (item.pricing_mode ?? "offer_price") {
    case "fixed_price":
      final = money(Number(item.fixed_amount));
      break;
    case "percent_discount":
      final = money(list * (1 - Number(item.discount_percent) / 100));
      break;
    case "free":
      final = 0;
      break;
    case "offer_price":
      break;
  }
  if (!Number.isFinite(final) || final < 0 || final > list && item.pricing_mode === "percent_discount") {
    throw new Error("invalid_final_amount");
  }
  return {
    ...item,
    list_amount: list,
    final_amount: final,
    discount_amount: money(Math.max(0, list - final)),
  };
}

export function buildComposableQuote(
  sourceItems: QuoteSourceItem[],
  adjustmentAmount = 0,
): { items: QuoteItem[]; subtotal: number; adjustment_amount: number; total: number } {
  if (sourceItems.length === 0 || sourceItems[0].role !== "primary") {
    throw new Error("primary_item_required");
  }
  if (new Set(sourceItems.map((item) => item.offer_id)).size !== sourceItems.length) {
    throw new Error("duplicate_offer");
  }
  const items = sourceItems.map(priceQuoteItem);
  const subtotal = money(items.reduce((sum, item) => sum + item.final_amount, 0));
  const adjustment = money(Number(adjustmentAmount));
  const total = money(subtotal + adjustment);
  if (!Number.isFinite(adjustment) || total < 0) throw new Error("invalid_adjustment");
  return { items, subtotal, adjustment_amount: adjustment, total };
}
