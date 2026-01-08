import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TariffFeature {
  id: string;
  tariff_id: string;
  text: string;
  icon: string | null;
  is_bonus: boolean;
  is_highlighted: boolean;
  sort_order: number;
  visibility_mode: string;
  active_from: string | null;
  active_to: string | null;
  label: string | null;
  link_url: string | null;
}

export interface TariffOffer {
  id: string;
  tariff_id: string;
  offer_type: "pay_now" | "trial";
  button_label: string;
  amount: number;
  trial_days: number | null;
  auto_charge_after_trial: boolean;
  auto_charge_amount: number | null;
  auto_charge_delay_days: number | null;
  requires_card_tokenization: boolean;
  sort_order: number;
}

export interface PublicTariff {
  id: string;
  code: string;
  name: string;
  description: string | null;
  badge: string | null;
  subtitle: string | null;
  price_monthly: number | null;
  period_label: string | null;
  access_days: number;
  features: TariffFeature[];
  offers: TariffOffer[];
  is_popular: boolean | null;
  current_price?: number | null;
  base_price?: number | null;
  discount_percent?: number | null;
}

export interface LandingConfig {
  hero_title?: string;
  hero_subtitle?: string;
  hero_description?: string;
  tariffs_title?: string;
  tariffs_subtitle?: string;
  disclaimer_text?: string;
  show_badges?: boolean;
  price_suffix?: string;
  sections?: {
    type: string;
    title?: string;
    content?: any;
  }[];
}

export interface PublicProduct {
  id: string;
  name: string;
  code: string;
  slug: string | null;
  currency: string;
  public_title: string | null;
  public_subtitle: string | null;
  payment_disclaimer_text: string | null;
  landing_config: LandingConfig;
}

export interface PublicProductData {
  product: PublicProduct;
  tariffs: PublicTariff[];
  pricing_stage: {
    id: string;
    name: string;
    stage_type: string;
  } | null;
}

export function usePublicProduct(domain: string | null) {
  return useQuery({
    queryKey: ["public-product", domain],
    queryFn: async (): Promise<PublicProductData | null> => {
      if (!domain) return null;

      const { data, error } = await supabase.functions.invoke("public-product", {
        body: null,
        headers: {},
      });

      // If edge function doesn't work with query params, try with domain param
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-product?domain=${encodeURIComponent(domain)}`,
        {
          headers: {
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error("Failed to fetch product");
      }

      return response.json();
    },
    enabled: !!domain,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: false,
  });
}

// Helper to get current domain
export function getCurrentDomain(): string {
  const hostname = window.location.hostname;
  // For localhost, return a test domain or empty
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "";
  }
  return hostname;
}
