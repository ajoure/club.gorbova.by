import { useQuery } from "@tanstack/react-query";

export interface PublicTariffData {
  product: {
    id: string;
    name: string;
    slug?: string;
    currency?: string;
    public_title?: string;
    public_subtitle?: string;
    payment_disclaimer_text?: string;
    primary_domain?: string | null;
    landing_config?: any;
  };
  tariff: {
    id: string;
    code: string;
    name: string;
    description?: string | null;
    badge?: string | null;
    subtitle?: string | null;
    price_monthly?: number | null;
    period_label?: string | null;
    access_days: number;
    is_popular?: boolean;
    public_id?: string;
    current_price?: number | null;
    base_price?: number | null;
    discount_percent?: number | null;
    features?: any[];
    offers?: any[];
  };
  pricing_stage?: any;
  is_reentry_pricing?: boolean;
  reentry_message?: string;
}

export function usePublicTariffByPublicId(
  tariffPublicId: string | null,
  userId?: string | null
) {
  return useQuery({
    queryKey: ["public-tariff-by-public-id", tariffPublicId, userId],
    queryFn: async (): Promise<PublicTariffData | null> => {
      if (!tariffPublicId) return null;

      let fetchUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-tariff-by-public-id?tariff_public_id=${encodeURIComponent(tariffPublicId)}`;
      if (userId) {
        fetchUrl += `&user_id=${encodeURIComponent(userId)}`;
      }

      const response = await fetch(fetchUrl, {
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error("Failed to fetch tariff");
      }

      return response.json();
    },
    enabled: !!tariffPublicId,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
}
