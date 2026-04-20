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

  // Filter tariffs by mode. Backward-compat: missing mode === 'all'.
  const mode = (content.tariff_filter_mode as "all" | "selected" | undefined) ?? "all";
  const allowedIds = (content.tariff_ids as string[] | undefined) ?? [];
  const filteredTariffs =
    mode === "selected"
      ? tariffs.filter((t) => allowedIds.includes(t.id)) // preserves source order; silently drops stale IDs
      : tariffs;

  if (filteredTariffs.length === 0) return null;

  return (
    <section id="tariffs" className="py-12 px-6">
      <UniversalPricingSection
        product={product}
        tariffs={filteredTariffs}
        sectionTitle={title}
        sectionSubtitle={subtitle}
      />
    </section>
  );
}
