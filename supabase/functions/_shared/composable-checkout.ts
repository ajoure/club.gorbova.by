export type PricingMode = "offer_price" | "fixed_price" | "percent_discount" | "free";
export type AccessDeliveryMode = "immediate" | "fixed_date" | "manual";

export interface QuoteSourceItem {
  role: "primary" | "addon";
  parent_offer_id?: string;
  product_id: string;
  product_name: string;
  tariff_id: string;
  tariff_name: string;
  offer_id: string;
  list_amount: number;
  pricing_mode?: PricingMode;
  fixed_amount?: number | null;
  discount_percent?: number | null;
  access_delivery_mode?: AccessDeliveryMode;
  access_opens_at?: string | null;
  access_duration_days?: number | null;
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

export function allocateComposablePayableTotal(
  quote: ReturnType<typeof buildComposableQuote>,
  payableTotal: number,
  adjustmentReason: string,
) {
  const payableMinor = Math.round(Number(payableTotal) * 100);
  const quotedMinor = Math.round(Number(quote.total) * 100);
  if (!Number.isFinite(payableMinor) || payableMinor <= 0 || quotedMinor <= 0) {
    throw new Error("invalid_payable_total");
  }
  if (!adjustmentReason.trim()) throw new Error("adjustment_reason_required");
  if (payableMinor === quotedMinor) return quote;

  const weighted = quote.items.map((item, index) => {
    const quotedItemMinor = Math.round(Number(item.final_amount) * 100);
    const exact = quotedItemMinor * payableMinor / quotedMinor;
    return {
      index,
      allocatedMinor: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });
  let remainderMinor = payableMinor -
    weighted.reduce((sum, item) => sum + item.allocatedMinor, 0);
  for (
    const allocation of weighted
      .slice()
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  ) {
    if (remainderMinor <= 0) break;
    allocation.allocatedMinor += 1;
    remainderMinor -= 1;
  }

  const allocatedByIndex = new Map(
    weighted.map((item) => [item.index, item.allocatedMinor]),
  );
  const items = quote.items.map((item, index) => {
    const finalAmount = (allocatedByIndex.get(index) ?? 0) / 100;
    return {
      ...item,
      final_amount: finalAmount,
      discount_amount: money(Math.max(0, Number(item.list_amount) - finalAmount)),
    };
  });

  return {
    ...quote,
    items,
    adjustment_amount: money(payableTotal - quote.subtotal),
    adjustment_reason: adjustmentReason.trim(),
    total: money(payableTotal),
    original_quote: quote,
  };
}
