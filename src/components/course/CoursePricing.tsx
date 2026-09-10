import { usePublicProduct } from "@/hooks/usePublicProduct";
import { UniversalPricingSection, UniversalPricingSkeleton } from "@/components/landing/UniversalPricingSection";
import { CbNativeTariffCard } from "@/pages/cb-native/sections/CbNativeTariffCard";
import { CB21_PRODUCT_ID, sortCbTariffsForDisplay } from "@/pages/cb-native/tariffPublicContract";

/** Both course landings use the same product, live offers and checkout dialogs. */
export function CoursePricing() {
  const { data, isLoading, error } = usePublicProduct({ productId: CB21_PRODUCT_ID });
  if (isLoading) return <UniversalPricingSkeleton />;
  if (error || !data?.product || data.product.id !== CB21_PRODUCT_ID || !data.tariffs?.length) {
    return <section id="tariffs" className="py-20 text-center px-4">Тарифы временно недоступны. Пожалуйста, попробуйте позже.</section>;
  }
  return (
    <UniversalPricingSection
      product={data.product}
      tariffs={sortCbTariffsForDisplay(data.tariffs)}
      sectionTitle="Выберите тариф"
      composableCheckoutMode="always"
      cardRenderer={({ tariff, index, onSelectOffer }) => (
        <CbNativeTariffCard tariff={tariff} index={index} onSelectOffer={onSelectOffer} />
      )}
    />
  );
}
