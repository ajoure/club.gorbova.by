/**
 * Tariff Card View-Model Normalizer
 * 
 * Decouples TariffCard rendering from business logic.
 * Used by admin preview path. Public runtime uses TariffCard directly.
 * Both paths use the shared resolver from resolveTariffDisplayConfig.ts.
 * 
 * RULES:
 * - price_display is VISUAL-ONLY fallback, never used in checkout/payments
 * - old_price priority: card_config.old_price > tariff.base_price
 * - is_highlighted priority: card_config.is_highlighted > tariff.is_popular
 * - badge priority: card_config.badge_text > tariff.badge
 * - price suffix priority: card_config.price_suffix > tariff.period_label > product.landing_config.price_suffix > "BYN"
 */

import { resolvePriceSuffix, resolveBadgeText, resolveOldPrice } from "./resolveTariffDisplayConfig";

export interface CardConfig {
  badge_text?: string | null;
  price_display?: number | null;
  old_price?: number | null;
  price_suffix?: string;
  cta_text?: string | null;
  footnote?: string | null;
  is_highlighted?: boolean;
  style_variant?: "default" | "highlighted" | "minimal" | "compact";
}

export interface TariffViewModelInput {
  id: string;
  code?: string;
  name: string;
  description?: string | null;
  badge?: string | null;
  subtitle?: string | null;
  period_label?: string | null;
  is_popular?: boolean | null;
  current_price?: number | null;
  base_price?: number | null;
  original_price?: number | null;
  price_monthly?: number | null;
  discount_percent?: number | null;
  meta?: { card_config?: CardConfig; [key: string]: any } | null;
  features?: any[];
  offers?: any[];
}

export interface TariffCardViewModel {
  id: string;
  code?: string;
  name: string;
  description?: string | null;
  subtitle?: string | null;
  period_label?: string | null;
  is_popular?: boolean | null;
  current_price?: number | null;
  base_price?: number | null;
  discount_percent?: number | null;
  badge?: string | null;
  features?: any[];
  offers?: any[];
  // Resolved card_config fields
  card_config?: CardConfig;
}

/**
 * Build a normalized view-model for TariffCard rendering.
 * 
 * @param tariff - Raw tariff data (from DB or admin form)
 * @param overridePriceSuffix - Global price suffix from product.landing_config
 * @returns Normalized data ready for TariffCard
 */
export function buildTariffCardViewModel(
  tariff: TariffViewModelInput,
  overridePriceSuffix?: string
): TariffCardViewModel {
  const cc = tariff.meta?.card_config;

  // Resolve badge via shared resolver
  const badge = resolveBadgeText({ cardConfig: cc, tariffBadge: tariff.badge });

  // Resolve is_highlighted: style_variant "highlighted" > card_config.is_highlighted > tariff.is_popular (legacy fallback)
  const isHighlighted = cc?.style_variant === "highlighted" || cc?.is_highlighted || tariff.is_popular || false;

  // Resolve old_price via shared resolver
  const oldPrice = resolveOldPrice({ cardConfig: cc, tariffBasePrice: (tariff as any).original_price ?? null });

  // Resolve price_suffix via shared resolver: card_config > period_label > product-level > "BYN"
  const resolvedSuffix = resolvePriceSuffix({
    cardConfig: cc,
    periodLabel: tariff.period_label,
    productPriceSuffix: overridePriceSuffix,
  });

  // Build card_config for TariffCard (pre-resolved, TariffCard will consume directly)
  const cardConfig: CardConfig = {
    badge_text: badge,
    price_display: cc?.price_display ?? null,
    old_price: oldPrice,
    price_suffix: resolvedSuffix,
    cta_text: cc?.cta_text ?? null,
    footnote: cc?.footnote ?? null,
    is_highlighted: !!isHighlighted,
    style_variant: cc?.style_variant || "default",
  };

  return {
    id: tariff.id,
    code: tariff.code,
    name: tariff.name,
    description: tariff.description,
    subtitle: tariff.subtitle,
    period_label: tariff.period_label,
    is_popular: isHighlighted,
    current_price: tariff.current_price,
    base_price: tariff.base_price,
    discount_percent: tariff.discount_percent,
    badge,
    features: tariff.features,
    offers: tariff.offers,
    card_config: cardConfig,
  };
}
