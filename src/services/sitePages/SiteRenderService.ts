import { supabase } from "@/integrations/supabase/client";
import type { SitePage } from "./types";

/**
 * SiteRenderService — public resolution of site pages by domain or slug.
 * No business logic — pure read operations for rendering.
 */
export class SiteRenderService {
  /**
   * Resolve a page by domain + path.
   * - "/" → home page (is_home = true)
   * - "/slug" → match slug among pages bound to this domain
   * - Ambiguous slug (>1 match) → null (404) + console.error
   */
  static async resolveByDomainAndPath(hostname: string, path: string): Promise<SitePage | null> {
    const normalizedPath = path.replace(/\/+$/, '').replace(/^\//, '');

    if (!normalizedPath) {
      // Home page resolution
      const { data: binding, error: bindError } = await (supabase
        .from("site_domain_bindings") as any)
        .select("site_page_id")
        .eq("domain", hostname)
        .eq("is_home", true)
        .maybeSingle();

      if (bindError || !binding) return null;

      const { data: page, error: pageError } = await (supabase
        .from("site_pages") as any)
        .select("*")
        .eq("id", binding.site_page_id)
        .eq("status", "published")
        .maybeSingle();

      if (pageError || !page) return null;
      return page as SitePage;
    }

    // Slug resolution: find all page_ids bound to this domain, then match slug
    const { data: bindings, error: bindingsError } = await (supabase
      .from("site_domain_bindings") as any)
      .select("site_page_id")
      .eq("domain", hostname);

    if (bindingsError || !bindings?.length) return null;

    const pageIds = bindings.map((b: any) => b.site_page_id);
    const { data: pages, error: pagesError } = await (supabase
      .from("site_pages") as any)
      .select("*")
      .in("id", pageIds)
      .eq("slug", normalizedPath)
      .eq("status", "published");

    if (pagesError || !pages || pages.length === 0) return null;

    if (pages.length > 1) {
      console.error(`Ambiguous slug "${normalizedPath}" for domain "${hostname}": ${pages.length} pages found`);
      return null;
    }

    return pages[0] as SitePage;
  }

  /** @deprecated Use resolveByDomainAndPath instead */
  static async resolveByDomain(hostname: string): Promise<SitePage | null> {
    return this.resolveByDomainAndPath(hostname, '/');
  }

  static async resolveBySlug(slug: string): Promise<SitePage | null> {
    const { data, error } = await (supabase
      .from("site_pages") as any)
      .select("*")
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();

    if (error || !data) return null;
    return data as SitePage;
  }

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
