/**
 * Shared Tariff Display Config Resolver
 * 
 * Single canonical owner of display field resolution for tariff cards.
 * Used by BOTH public runtime (TariffCard) and admin preview (tariffCardViewModel).
 * 
 * PRIORITY (tariff-level wins, product-level is fallback):
 *   price_suffix: card_config.price_suffix → tariff.period_label → product.landing_config.price_suffix → "BYN"
 *   old_price:    card_config.old_price → tariff.base_price → null
 *   badge:        card_config.badge_text → tariff.badge → null
 *   cta_text:     card_config.cta_text → null (offer.button_label handled separately)
 * 
 * RULES:
 * - NO logic based on offer_type, slug, code, product name, or tariff name
 * - NO special-case for any specific product (consultation, club, etc.)
 * - Only config-driven rendering
 */

import type { CardConfig } from "./tariffCardViewModel";

export interface ResolveSuffixInput {
  cardConfig?: CardConfig | null;
  periodLabel?: string | null;
  productPriceSuffix?: string | null;
}

/**
 * Resolve price suffix from tariff-level config, falling back to product-level, then "BYN".
 * 
 * Priority:
 * 1. card_config.price_suffix (explicit per-tariff setting)
 * 2. tariff.period_label (DB field on tariff)
 * 3. product.landing_config.price_suffix (product-level fallback)
 * 4. "BYN" (hardcoded default)
 */
export function resolvePriceSuffix(input: ResolveSuffixInput): string {
  return (
    input.cardConfig?.price_suffix ||
    input.periodLabel ||
    input.productPriceSuffix ||
    "BYN"
  );
}

export interface ResolveBadgeInput {
  cardConfig?: CardConfig | null;
  tariffBadge?: string | null;
}

/** Resolve badge text: card_config.badge_text → tariff.badge → null */
export function resolveBadgeText(input: ResolveBadgeInput): string | null {
  return input.cardConfig?.badge_text ?? input.tariffBadge ?? null;
}

export interface ResolveOldPriceInput {
  cardConfig?: CardConfig | null;
  tariffBasePrice?: number | null;
}

/** Resolve old/strikethrough price: card_config.old_price → tariff.base_price → null */
export function resolveOldPrice(input: ResolveOldPriceInput): number | null {
  return input.cardConfig?.old_price ?? input.tariffBasePrice ?? null;
}
