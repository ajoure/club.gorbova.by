import { Lock, Clock, Sparkles, ArrowRight, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSectionCatalog, SectionAccessRule } from "@/hooks/useSectionCatalog";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

interface SectionLockedStateProps {
  sectionCode: string;
  sectionLabel: string;
  isInactive?: boolean;
}

/**
 * Reusable locked-screen for gated/inactive sections.
 * Renders inside DashboardLayout (sidebar & breadcrumbs preserved).
 *
 * - isInactive=true → simplified "section unavailable" message
 * - isInactive=false → paywall with description, features, CTA
 */
export function SectionLockedState({
  sectionCode,
  sectionLabel,
  isInactive = false,
}: SectionLockedStateProps) {
  const navigate = useNavigate();
  const { data: catalog, isLoading } = useSectionCatalog(sectionCode);

  // --- Inactive section ---
  if (isInactive) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-5 max-w-lg mx-auto">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <Clock className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Раздел недоступен</h1>
          <p className="text-sm text-muted-foreground">
            Раздел «{sectionLabel}» временно деактивирован. Попробуйте вернуться позже.
          </p>
        </div>
      </div>
    );
  }

  // --- Loading catalog ---
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const description = catalog?.short_description;
  const features = catalog?.features_json ?? [];
  const rules = catalog?.available_via_rules ?? [];
  const ctaLabel = catalog?.cta_label || "Получить доступ";

  // Split rules into tariff-level and product-level
  const tariffRules = rules.filter((r) => r.tariff_id);
  const productRules = rules.filter((r) => !r.tariff_id && r.product_id);

  /**
   * CTA priority:
   * 1. Tariff with public_id → /pricing/tariff/:publicId
   * 2. Product with slug → /pricing/:slug
   * 3. Fallback → /products
   */
  const getCtaRoute = (rule: SectionAccessRule): string => {
    if (rule.tariff_public_id) {
      return `/pricing/tariff/${rule.tariff_public_id}`;
    }
    if (rule.product_slug) {
      return `/pricing/${rule.product_slug}`;
    }
    return "/products";
  };

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-8 max-w-xl mx-auto">
      {/* Lock icon */}
      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
        <Lock className="h-10 w-10 text-primary" />
      </div>

      {/* Title & description */}
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">{sectionLabel}</h1>
        {description && (
          <p className="text-base text-muted-foreground">{description}</p>
        )}
      </div>

      {/* Features */}
      {features.length > 0 && (
        <div className="w-full bg-muted/50 rounded-xl p-5 text-left space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Возможности раздела
          </h3>
          <ul className="space-y-2">
            {features.map((feature, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 text-sm text-foreground"
              >
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                {feature}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Access rules */}
      {(tariffRules.length > 0 || productRules.length > 0) && (
        <div className="w-full space-y-4">
          {tariffRules.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Доступно по тарифам
              </h3>
              <div className="flex flex-wrap gap-2 justify-center">
                {tariffRules.map((rule) => (
                  <Button
                    key={rule.rule_id}
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => navigate(getCtaRoute(rule))}
                  >
                    <ShoppingCart className="h-3.5 w-3.5" />
                    {rule.tariff_name || rule.target_label || "Тариф"}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {productRules.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Доступно по продуктам
              </h3>
              <div className="flex flex-wrap gap-2 justify-center">
                {productRules.map((rule) => (
                  <Button
                    key={rule.rule_id}
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => navigate(getCtaRoute(rule))}
                  >
                    <ShoppingCart className="h-3.5 w-3.5" />
                    {rule.product_name || rule.target_label || "Продукт"}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fallback CTA */}
      <Button
        size="lg"
        className="gap-2 px-8"
        onClick={() => {
          // Use first available rule's route, or fallback
          const firstRule = tariffRules[0] || productRules[0];
          navigate(firstRule ? getCtaRoute(firstRule) : "/products");
        }}
      >
        {ctaLabel}
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
