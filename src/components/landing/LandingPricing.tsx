import { useAuth } from "@/contexts/AuthContext";
import { AnimatedSection } from "./AnimatedSection";
import { UniversalPricingSection, UniversalPricingSkeleton } from "./UniversalPricingSection";
import { usePublicProduct } from "@/hooks/usePublicProduct";
import { PRODUCT_PAGES } from "@/config/productPages";

export function LandingPricing() {
  const { user } = useAuth();

  const { data: productData, isLoading } = usePublicProduct({ productCode: PRODUCT_PAGES.club.code }, user?.id);

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
