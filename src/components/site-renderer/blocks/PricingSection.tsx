/**
 * PricingSection — presentation-only wrapper around UniversalPricingSection.
 * Receives pre-fetched product + tariffs as props from container/page layer.
 * Zero data access, zero domain logic.
 * All links are UUID-driven (product_id), never title/slug/text.
 */
import { UniversalPricingSection } from "@/components/landing/UniversalPricingSection";
import type { PublicProduct, PublicTariff } from "@/hooks/usePublicProduct";

interface PricingSectionProps {
  content: Record<string, unknown>;
  product?: PublicProduct | null;
  tariffs?: PublicTariff[];
}

export function PricingSection({ content, product, tariffs }: PricingSectionProps) {
  if (!product || !tariffs?.length) return null;

  const title = (content.title as string) || undefined;
  const subtitle = (content.subtitle as string) || undefined;

  return (
    <section className="py-12 px-6">
      <UniversalPricingSection
        product={product}
        tariffs={tariffs}
        sectionTitle={title}
        sectionSubtitle={subtitle}
      />
    </section>
  );
}
