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
  offer_type: "pay_now" | "trial" | "preregistration" | "lead" | "bank_installment" | "invoice";
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
  meta?: { site_button_variant?: string; slot_role?: string; [key: string]: any } | null;
}

/** Actionable offer types — those that render a CTA button on tariff cards. */
const ACTIONABLE_TYPES = new Set([
  "pay_now",
  "trial",
  "preregistration",
  "lead",
  "bank_installment",
  "invoice",
]);

/**
 * Map meta.site_button_variant → shadcn Button variant + optional colour override.
 * Colour is a property of the offer (not its offer_type or its position).
 */
const VARIANT_STYLE: Record<string, { variant: "default" | "outline"; className?: string }> = {
  primary:      { variant: "default" },
  outline:      { variant: "outline" },
  installment:  { variant: "default", className: "bg-orange-500 hover:bg-orange-600 text-white border-transparent" },
  legal_entity: { variant: "default", className: "bg-emerald-600 hover:bg-emerald-700 text-white border-transparent" },
  lead:         { variant: "default", className: "bg-slate-500 hover:bg-slate-600 text-white border-transparent" },
};

function defaultLabelFor(offer: TariffCardOffer): string {
  if (offer.button_label) return offer.button_label;
  switch (offer.offer_type) {
    case "trial":            return `Пробный период ${offer.trial_days ?? ""} дней`.trim();
    case "preregistration":  return "Оставить заявку";
    case "lead":             return "Оставить заявку";
    case "bank_installment": return "Заявка на рассрочку от банка";
    case "invoice":          return "Сформировать счёт";
    default:                 return "Оплатить";
  }
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
  const preregOffers = resolvedOffers.filter(o => o.offer_type === "preregistration" && o.is_active !== false);
  const leadOffers = resolvedOffers.filter(o => o.offer_type === "lead" && o.is_active !== false);
  const bankInstallmentOffers = resolvedOffers.filter(o => o.offer_type === "bank_installment" && o.is_active !== false);
  const invoiceOffers = resolvedOffers.filter(o => o.offer_type === "invoice" && o.is_active !== false);

  // Primary offer for price display — strictly from offers only
  const primaryOffer = payNowOffers.find(o => o.is_primary) || payNowOffers[0];
  
  const hasConfiguredPriceDisplay = cc?.price_display != null && Number(cc.price_display) > 0;

  // Price resolution: primaryOffer.amount > invoiceOffers[0].amount > positive card_config.price_display > tariff.current_price
  const displayPrice = primaryOffer?.amount ?? invoiceOffers[0]?.amount ?? (hasConfiguredPriceDisplay ? cc?.price_display : null) ?? tariff.current_price ?? null;
  const hasActivePayOffers = payNowOffers.length > 0;
  const hasAnyActionableOffer = payNowOffers.length > 0 || trialOffers.length > 0 || preregOffers.length > 0 || leadOffers.length > 0 || bankInstallmentOffers.length > 0 || invoiceOffers.length > 0;

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

      {(() => {
        // Hide price block for lead-only tariffs unless card_config.price_display is explicitly set to a positive amount.
        const isLeadOnly = (leadOffers.length > 0 || bankInstallmentOffers.length > 0) && payNowOffers.length === 0 && trialOffers.length === 0 && preregOffers.length === 0;
        if (isLeadOnly && !hasConfiguredPriceDisplay) return null;
        return (
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
        );
      })()}


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

      {showButtons && hasAnyActionableOffer && (() => {
        // SINGLE SOURCE OF ORDER: sort_order ASC, id ASC across ALL actionable offers.
        // Groups by offer_type are NOT used for positioning — only for label defaults
        // and downstream dialog routing (handled by onSelectOffer consumer).
        const actionableOffers = resolvedOffers
          .filter((o) => o.is_active !== false && ACTIONABLE_TYPES.has(o.offer_type))
          .slice()
          .sort(
            (a, b) =>
              ((a.sort_order ?? 0) - (b.sort_order ?? 0)) ||
              a.id.localeCompare(b.id),
          );
        return (
          <div className="space-y-2 mt-auto">
            {actionableOffers.map((offer, index) => {
              const rawVariant = (offer.meta?.site_button_variant ?? "").toString().trim();
              const style = VARIANT_STYLE[rawVariant] ?? { variant: "outline" as const };
              const label =
                cc?.cta_text && offer.offer_type === "pay_now" && index === 0 && !rawVariant
                  ? cc.cta_text
                  : defaultLabelFor(offer);
              const showChevron = offer.offer_type !== "trial";
              return (
                <Button
                  key={offer.id}
                  onClick={() => onSelectOffer?.(offer, tariff)}
                  variant={style.variant}
                  className={cn("w-full", style.className)}
                >
                  {label}
                  {showChevron && <ChevronRight className="ml-2 h-4 w-4" />}
                </Button>
              );
            })}
          </div>
        );
      })()}

      {footnote && (
        <p className="text-xs text-muted-foreground text-center mt-3">{footnote}</p>
      )}
    </GlassCard>
  );
}
