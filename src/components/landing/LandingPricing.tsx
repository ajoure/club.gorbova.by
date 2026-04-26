import { useAuth } from "@/contexts/AuthContext";
import { UniversalPricingSection, UniversalPricingSkeleton } from "./UniversalPricingSection";
import { usePublicProduct } from "@/hooks/usePublicProduct";
import { PRODUCT_PAGES } from "@/config/productPages";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

export function LandingPricing() {
  const { user } = useAuth();

  const { data: productData, isLoading, error, refetch, isFetching } = usePublicProduct(
    { productCode: PRODUCT_PAGES.club.code },
    user?.id,
  );

  if (isLoading) {
    return <UniversalPricingSkeleton />;
  }

  // Error-state — секция не должна молча исчезать.
  if (error) {
    return (
      <section id="tariffs" className="py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-xl mx-auto text-center rounded-2xl border border-border/50 bg-card/60 backdrop-blur p-8">
            <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={24} />
            </div>
            <h2 className="text-2xl font-semibold text-foreground mb-2">Тарифы временно недоступны</h2>
            <p className="text-muted-foreground mb-6">
              Не удалось загрузить тарифы. Обновите страницу или попробуйте позже.
            </p>
            <Button onClick={() => refetch()} disabled={isFetching} variant="outline">
              <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} />
              Повторить загрузку
            </Button>
          </div>
        </div>
      </section>
    );
  }

  // Empty success — данные пришли, но пусто.
  if (!productData?.product || !productData.tariffs?.length) {
    return (
      <section id="tariffs" className="py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-xl mx-auto text-center rounded-2xl border border-border/50 bg-card/60 backdrop-blur p-8">
            <h2 className="text-2xl font-semibold text-foreground mb-2">Тарифы временно недоступны</h2>
            <p className="text-muted-foreground">
              Тарифы временно недоступны. Загляните чуть позже.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <UniversalPricingSection
      product={productData.product}
      tariffs={productData.tariffs}
      pricingStage={productData.pricing_stage}
      isReentryPricing={productData.is_reentry_pricing}
      reentryMessage={productData.reentry_message}
    />
  );
}
