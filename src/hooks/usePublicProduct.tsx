import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCanonicalHostname } from "@/utils/accessAlias";

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
  document_scenarios?: unknown;
  slot_role?: string;
  site_button_variant?: string;
}

export interface TariffOffer {
  id: string;
  tariff_id: string;
  offer_type: "pay_now" | "trial" | "preregistration" | "lead" | "bank_installment" | "invoice";
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
  has_available_addons?: boolean;
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
  is_public?: boolean;
  is_popular: boolean | null;
  current_price?: number | null;
  base_price?: number | null;
  discount_percent?: number | null;
  meta?: { card_config?: import("@/lib/tariffCardViewModel").CardConfig; [key: string]: any } | null;
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
  /**
   * Раскладка тарифной секции на всех product-driven рендерерах
   * (publish pages, site-builder pricing block, admin preview).
   * - "auto" (default): TariffCarouselGrid решает сам (карусель при count > 3, иначе grid).
   * - "vertical-grid": всегда CSS-grid 1col mobile / 2col md+. Без карусели.
   * SoT — продукт. Page/block-specific override запрещён.
   */
  tariffs_layout?: "auto" | "vertical-grid";
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
  _meta?: {
    resolved_by: 'product_id' | 'product_code' | 'domain';
    resolved_value: string;
  };
}

// ─── Lookup types ───
// Explicit binding by product code (preferred for page-based landings)
// Explicit binding by product ID
// Legacy domain-based lookup (for DomainRouter fallback)

export type ProductLookup =
  | { productCode: string }
  | { productId: string }
  | { domain: string }
  | string   // backward compat: treated as domain
  | null;    // disabled

/**
 * Normalize ProductLookup into query params for the EF.
 * Returns null if lookup is disabled.
 */
function buildLookupParams(lookup: ProductLookup): { key: string; param: string; value: string } | null {
  if (lookup === null || lookup === undefined) return null;

  // Backward compat: plain string = domain
  if (typeof lookup === "string") {
    if (!lookup) return null; // empty string = disabled
    return { key: lookup, param: "domain", value: lookup };
  }

  if ("productId" in lookup && lookup.productId) {
    return { key: lookup.productId, param: "product_id", value: lookup.productId };
  }
  if ("productCode" in lookup && lookup.productCode) {
    return { key: lookup.productCode, param: "product_code", value: lookup.productCode };
  }
  if ("domain" in lookup && lookup.domain) {
    return { key: lookup.domain, param: "domain", value: lookup.domain };
  }

  return null;
}

export interface UsePublicProductOptions {
  /**
   * When true, poll every 30s and refetch on window focus. Used by dynamic-slot
   * public pages (`data-lovable-slot` markers) so admin edits propagate without
   * a redeploy. Off by default — regular usage keeps staleTime=5min.
   */
  poll?: boolean;
}

export function usePublicProduct(
  lookup: ProductLookup,
  userId?: string | null,
  options?: UsePublicProductOptions,
) {
  const resolved = buildLookupParams(lookup);
  const poll = options?.poll === true;

  return useQuery({
    queryKey: ["public-product", resolved?.param, resolved?.key, userId],
    queryFn: async (): Promise<PublicProductData | null> => {
      if (!resolved) return null;

      let fetchUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-product?${resolved.param}=${encodeURIComponent(resolved.value)}`;
      if (userId) {
        fetchUrl += `&user_id=${encodeURIComponent(userId)}`;
      }

      let response: Response;
      try {
        response = await fetch(fetchUrl, {
          headers: {
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
        });
      } catch (err) {
        console.error("[usePublicProduct] public-product fetch failed", { url: fetchUrl, error: err });
        throw err;
      }

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        console.error("[usePublicProduct] public-product fetch failed", { url: fetchUrl, status: response.status });
        throw new Error(`Failed to fetch product (status ${response.status})`);
      }

      return response.json();
    },
    enabled: !!resolved,
    staleTime: poll ? 0 : 1000 * 60 * 5,
    retry: 2,
    refetchInterval: poll ? 30_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: poll ? true : undefined,
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

// Helper to get current domain (legacy — only used by DomainRouter)
export function getCurrentDomain(): string {
  const hostname = getCanonicalHostname(window.location.hostname);
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
