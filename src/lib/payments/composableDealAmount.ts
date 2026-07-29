export interface DealWithCommercialAmount {
  final_price?: number | string | null;
  composable_line_amount?: number | string | null;
  composable_group_total?: number | string | null;
  composable_group_role?: "primary" | "addon" | null;
}

/**
 * orders_v2.final_price on the primary composable order is the payment
 * container total. CRM rows and item refunds must display the immutable line
 * amount instead, otherwise the basket is counted twice beside its add-ons.
 */
export function getDealCommercialAmount(
  deal: DealWithCommercialAmount | null | undefined,
): number {
  const lineAmount = Number(deal?.composable_line_amount);
  if (
    deal?.composable_line_amount !== null &&
    deal?.composable_line_amount !== undefined &&
    Number.isFinite(lineAmount)
  ) {
    return lineAmount;
  }
  const fallback = Number(deal?.final_price);
  return Number.isFinite(fallback) ? fallback : 0;
}
