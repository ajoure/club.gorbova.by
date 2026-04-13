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

export interface TariffOfferMeta {
  charge_window_start?: number;
  charge_window_end?: number;
  is_recurring?: boolean;
  recurring_interval_days?: number;
  preregistration?: {
    first_charge_date?: string;
    charge_offer_id?: string;
    notify_before_days?: number;
    auto_convert_after_date?: boolean;
    charge_window_start?: number;
    charge_window_end?: number;
  };
}

export interface TariffOffer {
  id: string;
  tariff_id: string;
  offer_type: "pay_now" | "trial" | "preregistration";
  button_label: string;
  amount: number;
  trial_days: number | null;
  auto_charge_after_trial: boolean;
  auto_charge_amount: number | null;
  auto_charge_delay_days: number | null;
  requires_card_tokenization: boolean;
  sort_order: number;
  is_active?: boolean;
  is_primary?: boolean;
  payment_method?: string;
  installment_count?: number;
  meta?: TariffOfferMeta;
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
  telegram_club_id: string | null;
}

export interface PublicProductData {
  product: PublicProduct;
  tariffs: PublicTariff[];
  pricing_stage: {
    id: string;
    name: string;
    stage_type: string;
  } | null;
  is_reentry_pricing?: boolean;
  reentry_message?: string;
}

export function usePublicProduct(domain: string | null, userId?: string | null) {
  return useQuery({
    queryKey: ["public-product", domain, userId],
    queryFn: async (): Promise<PublicProductData | null> => {
      if (!domain) return null;

      // Build URL with optional user_id for reentry pricing
      let fetchUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-product?domain=${encodeURIComponent(domain)}`;
      if (userId) {
        fetchUrl += `&user_id=${encodeURIComponent(userId)}`;
      }

      const response = await fetch(fetchUrl, {
        headers: {
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
      });

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

// Extended product type for slug-based lookup (includes primary_domain for banner)
export interface PublicProductBySlug extends PublicProduct {
  primary_domain?: string | null;
}

export interface PublicProductBySlugData extends Omit<PublicProductData, 'product'> {
  product: PublicProductBySlug;
}

export function usePublicProductBySlug(slug: string | null, userId?: string | null) {
  return useQuery({
    queryKey: ["public-product-by-slug", slug, userId],
    queryFn: async (): Promise<PublicProductBySlugData | null> => {
      if (!slug) return null;

      let fetchUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-product-by-slug?slug=${encodeURIComponent(slug)}`;
      if (userId) {
        fetchUrl += `&user_id=${encodeURIComponent(userId)}`;
      }

      const response = await fetch(fetchUrl, {
        headers: {
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error("Failed to fetch product by slug");
      }

      return response.json();
    },
    enabled: !!slug,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
}

// Helper to get current domain
export function getCurrentDomain(): string {
  const hostname = window.location.hostname;
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.includes(".lovable.app") ||
    hostname.includes(".lovableproject.com")
  ) {
    return "";
  }
  return hostname;
}
