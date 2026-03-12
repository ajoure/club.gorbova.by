import { useAuth } from "@/contexts/AuthContext";
import { AnimatedSection } from "./AnimatedSection";
import { UniversalPricingSection, UniversalPricingSkeleton } from "./UniversalPricingSection";
import { usePublicProduct } from "@/hooks/usePublicProduct";

export function LandingPricing() {
  const { user } = useAuth();

  // Always use the production domain for the club landing, not preview domains
  const { data: productData, isLoading } = usePublicProduct("club.gorbova.by", user?.id);

  if (isLoading) {
    return <UniversalPricingSkeleton />;
  }

  if (!productData?.product || !productData.tariffs?.length) {
    return null;
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
