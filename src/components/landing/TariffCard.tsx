import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/GlassCard";
import { Check, ChevronRight } from "lucide-react";
import type { CardConfig } from "@/lib/tariffCardViewModel";
import { resolvePriceSuffix, resolveBadgeText, resolveOldPrice } from "@/lib/resolveTariffDisplayConfig";
import { cn } from "@/lib/utils";

export interface TariffCardFeature {
  id: string;
  text: string;
  is_bonus?: boolean;
  is_highlighted?: boolean;
  label?: string;
  link_url?: string | null;
  visibility_mode?: string;
  active_from?: string | null;
  active_to?: string | null;
}

export interface TariffCardOffer {
  id: string;
  offer_type: "pay_now" | "trial" | "preregistration";
  button_label: string;
  amount: number;
  trial_days?: number | null;
  auto_charge_after_trial?: boolean;
  auto_charge_amount?: number | null;
  requires_card_tokenization?: boolean;
  is_active?: boolean;
  is_primary?: boolean;
  sort_order?: number;
  payment_method?: string | null;
  installment_count?: number | null;
}

export interface TariffCardData {
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
  price_monthly?: number | null;
  discount_percent?: number | null;
  // Nested data (from public EF)
  features?: TariffCardFeature[];
  offers?: TariffCardOffer[];
  // Visual config: direct card_config (from admin preview) or from meta.card_config (from public EF)
  card_config?: CardConfig;
  meta?: { card_config?: CardConfig; [key: string]: any } | null;
}

interface TariffCardProps {
  tariff: TariffCardData;
  // Override props (from admin preview where features/offers come separately)
  features?: TariffCardFeature[];
  offers?: TariffCardOffer[];
  onSelectOffer?: (offer: TariffCardOffer, tariff: TariffCardData) => void;
  showBadges?: boolean;
  showButtons?: boolean;
  /** Price suffix from product.landing_config.price_suffix (e.g. "BYN/мес"). Fallback: "BYN" */
  priceSuffix?: string;
}

const styleVariantClasses: Record<string, string> = {
  default: "",
  highlighted: "border-primary/50 ring-2 ring-primary/20 bg-primary/[0.03]",
  minimal: "border-border/20 shadow-none bg-card/50",
  compact: "p-4 [&_h3]:text-lg [&_.price-value]:text-2xl",
};

export function TariffCard({
  tariff,
  features: featuresProp,
  offers: offersProp,
  onSelectOffer,
  showBadges = true,
  showButtons = true,
  priceSuffix = "BYN",
}: TariffCardProps) {
  // Resolve card_config: direct prop (admin preview) > meta.card_config (public EF)
  const cc = tariff.card_config || tariff.meta?.card_config;

  // Resolve data: props override → nested in tariff → empty
  const resolvedFeatures = featuresProp ?? tariff.features ?? [];
  const resolvedOffers = offersProp ?? tariff.offers ?? [];

  const payNowOffers = resolvedOffers.filter(o => o.offer_type === "pay_now" && o.is_active !== false);
  const trialOffers = resolvedOffers.filter(o => o.offer_type === "trial" && o.is_active !== false);

  // Primary offer for price display — strictly from offers only
  const primaryOffer = payNowOffers.find(o => o.is_primary) || payNowOffers[0];
  
  // Price resolution: primaryOffer.amount > card_config.price_display > tariff.current_price > null
  const displayPrice = primaryOffer?.amount ?? cc?.price_display ?? tariff.current_price ?? null;
  const hasActivePayOffers = payNowOffers.length > 0;

  // Old/strikethrough price: card_config.old_price > tariff.base_price. Show only if > displayPrice
  const oldPrice = resolveOldPrice({ cardConfig: cc, tariffBasePrice: tariff.base_price });
  const showOldPrice = oldPrice != null && displayPrice != null && oldPrice > displayPrice;

  // Resolved suffix via shared resolver: card_config > period_label > product-level > "BYN"
  const resolvedSuffix = resolvePriceSuffix({
    cardConfig: cc,
    periodLabel: tariff.period_label,
    productPriceSuffix: priceSuffix,
  });

  // Badge via shared resolver: card_config.badge_text > tariff.badge
  const badgeText = resolveBadgeText({ cardConfig: cc, tariffBadge: tariff.badge });

  // Style variant
  const styleVariant = cc?.style_variant || "default";
  const variantClass = styleVariantClasses[styleVariant] || "";

  // Highlight: style_variant "highlighted" > card_config.is_highlighted > tariff.is_popular (legacy fallback)
  const isHighlighted = styleVariant === "highlighted" || cc?.is_highlighted || tariff.is_popular || false;

  // Footnote
  const footnote = cc?.footnote;

  // Filter features by visibility (client-side, for admin preview)
  const visibleFeatures = resolvedFeatures.filter(f => {
    if (!f.visibility_mode || f.visibility_mode === "always") return true;
    const now = new Date();
    if (f.visibility_mode === "until_date" && f.active_to) {
      return now <= new Date(f.active_to);
    }
    if (f.visibility_mode === "date_range") {
      const from = f.active_from ? new Date(f.active_from) : null;
      const to = f.active_to ? new Date(f.active_to) : null;
      if (from && now < from) return false;
      if (to && now > to) return false;
      return true;
    }
    return true;
  });

  return (
    <GlassCard
      className={cn(
        "p-6 relative flex flex-col h-full",
        isHighlighted && styleVariant !== "highlighted" && "border-primary/50 ring-2 ring-primary/20",
        variantClass
      )}
    >
      {showBadges && badgeText && (
        <Badge
          className={cn(
            "absolute -top-3 left-1/2 -translate-x-1/2",
            isHighlighted
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground"
          )}
        >
          {badgeText}
        </Badge>
      )}

      <div className="text-center mb-4">
        <h3 className="text-xl font-bold text-foreground">{tariff.name}</h3>
        {tariff.subtitle && (
          <p className="text-sm text-muted-foreground mt-1">{tariff.subtitle}</p>
        )}
      </div>

      <div className="text-center mb-4">
        {displayPrice !== null ? (
          <div>
            {showOldPrice && (
              <div className="text-lg text-muted-foreground line-through">
                {oldPrice} {resolvedSuffix}
              </div>
            )}
            <div className="text-3xl font-bold text-foreground price-value">
              {displayPrice} <span className="text-base font-normal text-muted-foreground">{resolvedSuffix}</span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Цена не задана</div>
        )}
      </div>

      {tariff.description && (
        <p className="text-sm text-muted-foreground text-center mb-4">{tariff.description}</p>
      )}

      {visibleFeatures.length > 0 && (
        <ul className="space-y-2 mb-6 flex-1">
          {visibleFeatures.map((feature) => (
            <li key={feature.id} className={cn(
              "flex items-start gap-2 text-sm",
              feature.is_highlighted ? "text-primary font-medium" : "text-foreground"
            )}>
              <Check size={16} className={cn(
                "mt-0.5 flex-shrink-0",
                feature.is_highlighted ? "text-primary" : "text-primary/70"
              )} />
              <span>
                {feature.text}
                {feature.is_bonus && (
                  <Badge variant="secondary" className="ml-2 text-xs">Бонус</Badge>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {showButtons && hasActivePayOffers && (
        <div className="space-y-2 mt-auto">
          {trialOffers.map((offer) => (
            <Button
              key={offer.id}
              onClick={() => onSelectOffer?.(offer, tariff)}
              variant="outline"
              className="w-full"
            >
              {offer.button_label || `Пробный период ${offer.trial_days} дней`}
            </Button>
          ))}
          {payNowOffers.map((offer, index) => (
            <Button
              key={offer.id}
              onClick={() => onSelectOffer?.(offer, tariff)}
              variant={isHighlighted && index === 0 ? "default" : "outline"}
              className="w-full"
            >
              {cc?.cta_text && index === 0 ? cc.cta_text : (offer.button_label || "Оплатить")}
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          ))}
        </div>
      )}

      {footnote && (
        <p className="text-xs text-muted-foreground text-center mt-3">{footnote}</p>
      )}
    </GlassCard>
  );
}
