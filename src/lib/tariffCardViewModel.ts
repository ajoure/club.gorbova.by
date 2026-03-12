/**
 * Tariff Card View-Model Normalizer
 * 
 * Decouples TariffCard rendering from business logic.
 * Used by both public landing pages and admin preview.
 * 
 * RULES:
 * - price_display is VISUAL-ONLY fallback, never used in checkout/payments
 * - old_price priority: card_config.old_price > tariff.original_price
 * - is_highlighted priority: card_config.is_highlighted > tariff.is_popular
 * - badge priority: card_config.badge_text > tariff.badge
 * - price suffix priority: priceSuffix param > card_config.price_suffix > "BYN"
 */

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

  // Resolve badge: card_config > tariff.badge
  const badge = cc?.badge_text ?? tariff.badge ?? null;

  // Resolve is_popular: card_config.is_highlighted > tariff.is_popular
  const isHighlighted = cc?.is_highlighted ?? tariff.is_popular ?? false;

  // Resolve old_price: card_config.old_price > tariff.original_price
  const oldPrice = cc?.old_price ?? (tariff as any).original_price ?? null;

  // Build card_config for TariffCard
  const cardConfig: CardConfig = {
    badge_text: badge,
    price_display: cc?.price_display ?? null,
    old_price: oldPrice,
    price_suffix: overridePriceSuffix || cc?.price_suffix || "BYN",
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
