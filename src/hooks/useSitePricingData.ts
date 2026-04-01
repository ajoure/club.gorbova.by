import { useQueries } from "@tanstack/react-query";
import type { SiteBlock } from "@/services/sitePages/types";
import type { PricingDataMap } from "@/components/site-renderer/SitePageRenderer";
import type { PublicProductData } from "@/hooks/usePublicProduct";

/**
 * Scans site blocks for pricing blocks with product_id,
 * fetches product data via public-product EF, returns PricingDataMap.
 */
export function useSitePricingData(blocks: SiteBlock[]): {
  pricingData: PricingDataMap;
  isLoading: boolean;
} {
  // Extract unique product IDs from pricing blocks
  const productIds = Array.from(
    new Set(
      blocks
        .filter((b) => b.type === "pricing" && b.content?.product_id)
        .map((b) => b.content.product_id as string)
    )
  );

  const queries = useQueries({
    queries: productIds.map((pid) => ({
      queryKey: ["public-product-by-id", pid],
      queryFn: async (): Promise<PublicProductData | null> => {
        const fetchUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-product?product_id=${encodeURIComponent(pid)}`;
        const response = await fetch(fetchUrl, {
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
        });
        if (!response.ok) return null;
        return response.json();
      },
      staleTime: 1000 * 60 * 5,
      retry: false,
      enabled: !!pid,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);

  const pricingData: PricingDataMap = {};
  queries.forEach((q, i) => {
    if (q.data) {
      pricingData[productIds[i]] = {
        product: q.data.product,
        tariffs: q.data.tariffs,
      };
    }
  });

  return { pricingData, isLoading };
}
