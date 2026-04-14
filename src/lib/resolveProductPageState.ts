/**
 * resolveProductPageState — единый resolver состояния привязки продукта к странице.
 *
 * Source of truth: site_pages.product_id (canonical binding) + site_pages.blocks (pricing detection).
 * Используется в карточке продукта и в настройках страницы конструктора.
 */

import type { SiteBlock } from "@/services/sitePages/types";

export interface ProductPageState {
  /** Страница привязана к продукту */
  isLinked: boolean;
  /** На странице есть хотя бы один pricing block (любого продукта) */
  hasPricingBlock: boolean;
  /** Найден pricing block именно этого продукта */
  pricingBlockMatchesProduct: boolean;
  /** Количество pricing блоков этого продукта на странице */
  pricingBlockCount: number;
  /** Найден pricing block, но он указывает на другой продукт */
  hasMismatchedPricingBlock: boolean;
  /** Страница готова к продаже: привязана + есть pricing block этого продукта */
  isPricingReady: boolean;
}

/**
 * Диагностические состояния для UI:
 * - "not_linked"              — страница не привязана
 * - "linked_no_pricing"       — привязана, блока тарифов нет
 * - "linked_pricing_mismatch" — привязана, pricing block есть, но чужого продукта
 * - "linked_pricing_ready"    — привязана, pricing block этого продукта найден
 * - "linked_pricing_multiple" — привязана, несколько pricing block этого продукта
 */
export type ProductPageDiagnostic =
  | "not_linked"
  | "linked_no_pricing"
  | "linked_pricing_mismatch"
  | "linked_pricing_ready"
  | "linked_pricing_multiple";

export function resolveProductPageState(
  blocks: SiteBlock[] | null | undefined,
  productId: string,
  isLinked: boolean,
): ProductPageState {
  const safeBlocks = blocks || [];

  const pricingBlocks = safeBlocks.filter(
    (b) => b.type === "pricing",
  );

  const matchingBlocks = pricingBlocks.filter(
    (b) => (b.content as Record<string, unknown>)?.product_id === productId,
  );

  const hasPricingBlock = pricingBlocks.length > 0;
  const pricingBlockMatchesProduct = matchingBlocks.length > 0;
  const pricingBlockCount = matchingBlocks.length;

  // Есть pricing block, но ни один не совпадает с текущим продуктом
  const hasMismatchedPricingBlock =
    hasPricingBlock && !pricingBlockMatchesProduct;

  const isPricingReady = isLinked && pricingBlockMatchesProduct;

  return {
    isLinked,
    hasPricingBlock,
    pricingBlockMatchesProduct,
    pricingBlockCount,
    hasMismatchedPricingBlock,
    isPricingReady,
  };
}

export function getProductPageDiagnostic(
  state: ProductPageState,
): ProductPageDiagnostic {
  if (!state.isLinked) return "not_linked";
  if (!state.hasPricingBlock) return "linked_no_pricing";
  if (state.hasMismatchedPricingBlock) return "linked_pricing_mismatch";
  if (state.pricingBlockCount > 1) return "linked_pricing_multiple";
  return "linked_pricing_ready";
}
