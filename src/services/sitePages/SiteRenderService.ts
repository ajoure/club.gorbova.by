import { supabase } from "@/integrations/supabase/client";
import type { SitePage } from "./types";

/**
 * SiteRenderService — public resolution of site pages by domain or slug.
 * No business logic — pure read operations for rendering.
 */
export class SiteRenderService {
  /**
   * Resolve a published page by hostname.
   * Used by DomainRouter to check if a domain has a site builder page.
   */
  static async resolveByDomain(hostname: string): Promise<SitePage | null> {
    const { data: binding, error: bindError } = await supabase
      .from("site_domain_bindings")
      .select("site_page_id")
      .eq("domain", hostname)
      .maybeSingle();

    if (bindError || !binding) return null;

    const { data: page, error: pageError } = await supabase
      .from("site_pages")
      .select("*")
      .eq("id", binding.site_page_id)
      .eq("status", "published")
      .maybeSingle();

    if (pageError || !page) return null;
    return page as unknown as SitePage;
  }

  /**
   * Resolve a published page by slug.
   */
  static async resolveBySlug(slug: string): Promise<SitePage | null> {
    const { data, error } = await supabase
      .from("site_pages")
      .select("*")
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();

    if (error || !data) return null;
    return data as unknown as SitePage;
  }

  /**
   * Fetch tariffs for a product (service boundary for pricing block).
   */
  static async getTariffsForProduct(productId: string) {
    const { data, error } = await supabase
      .from("tariffs")
      .select("*")
      .eq("product_id", productId)
      .eq("is_active", true)
      .order("sort_order");

    if (error) throw new Error(`Failed to fetch tariffs: ${error.message}`);
    return data || [];
  }
}
