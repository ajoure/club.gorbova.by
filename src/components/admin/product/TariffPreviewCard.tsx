import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Gift, CreditCard, Zap, Star } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";

interface TariffFeature {
  id: string;
  text: string;
  is_bonus?: boolean;
  label?: string;
}

interface TariffOffer {
  id: string;
  offer_type: "pay_now" | "trial" | "preregistration";
  button_label: string;
  amount: number;
  is_active: boolean;
  is_primary?: boolean;
}

interface TariffPreviewCardProps {
  tariff: {
    id: string;
    name: string;
    subtitle?: string;
    badge?: string;
    is_popular?: boolean;
    period_label?: string;
  };
  features: TariffFeature[];
  offers: TariffOffer[];
  showButtons?: boolean;
  onSelectOffer?: (offer: TariffOffer, tariff: any) => void;
}

export function TariffPreviewCard({
  tariff,
  features,
  offers,
  showButtons = true,
  onSelectOffer,
}: TariffPreviewCardProps) {
  // Primary offer takes precedence for price display, fallback to first active pay_now
  const mainOffer = offers.find(o => o.offer_type === "pay_now" && o.is_active && o.is_primary) 
    || offers.find(o => o.offer_type === "pay_now" && o.is_active);
  const trialOffer = offers.find(o => o.offer_type === "trial" && o.is_active);
  const displayPrice = mainOffer?.amount ?? null;

  return (
    <div
      className={`relative rounded-2xl border transition-all duration-300 h-full flex flex-col ${
        tariff.is_popular
          ? "border-primary shadow-lg ring-2 ring-primary/20"
          : "border-border/50"
      }`}
      style={{
        background:
          "linear-gradient(135deg, hsl(var(--card) / 0.95), hsl(var(--card) / 0.85))",
        backdropFilter: "blur(20px)",
      }}
    >
      {/* Badge */}
      {tariff.badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1 z-10">
          <Star size={14} />
          {tariff.badge}
        </div>
      )}

      {/* Content Container */}
      <div className="p-6 flex flex-col flex-1">
        {/* Header */}
        <div className="text-center mb-4">
          <h3 className="text-xl font-bold text-foreground mb-1">
            {tariff.name}
          </h3>
          {tariff.subtitle && (
            <p className="text-sm text-muted-foreground">
              {tariff.subtitle}
            </p>
          )}
        </div>

        {/* Price */}
        <div className="text-center mb-4">
          {displayPrice !== null ? (
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-4xl font-bold text-foreground">{displayPrice}</span>
              <span className="text-muted-foreground">
                {tariff.period_label || "BYN/мес"}
              </span>
            </div>
          ) : (
            <div className="text-sm text-destructive">Не задана основная цена</div>
          )}
        </div>

        {/* Features - flex-1 to push buttons down */}
        <ul className="space-y-2 mb-4 flex-1">
          {features.map((feature) => (
            <li key={feature.id} className="flex items-start gap-2">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                  feature.is_bonus
                    ? "bg-amber-500/20"
                    : "bg-primary/10"
                }`}
              >
                {feature.is_bonus ? (
                  <Gift className="text-amber-500" size={12} />
                ) : (
                  <Check className="text-primary" size={12} />
                )}
              </div>
              <span
                className={`text-sm ${
                  feature.is_bonus
                    ? "text-foreground font-medium"
                    : "text-muted-foreground"
                }`}
              >
                {feature.text}
                {feature.label && (
                  <span className="ml-1 text-xs text-amber-600">
                    {feature.label}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>

        {/* Buttons Container - fixed at bottom */}
        {showButtons && (
          <div className="space-y-2 mt-auto pt-4">
            {/* Primary Button Row */}
            <div className="min-h-[40px]">
              {mainOffer ? (
                <Button
                  className="w-full gap-2"
                  variant={tariff.is_popular ? "default" : "outline"}
                  onClick={() => onSelectOffer?.(mainOffer, tariff)}
                >
                  <CreditCard size={16} />
                  {mainOffer.button_label}
                </Button>
              ) : (
                <Button className="w-full" variant="outline" disabled>
                  Нет кнопки
                </Button>
              )}
            </div>
            
            {/* Trial Button Row - only render if exists */}
            {trialOffer && (
              <div className="min-h-[40px]">
                <Button
                  className="w-full gap-2"
                  variant="secondary"
                  onClick={() => onSelectOffer?.(trialOffer, tariff)}
                >
                  <Zap size={16} />
                  {trialOffer.button_label}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
