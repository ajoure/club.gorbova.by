import { supabase } from "@/integrations/supabase/client";
import type { SitePage } from "./types";

/**
 * Discriminated result for public page resolution.
 * - "ok": page found
 * - "not-found": query succeeded but no published page matches
 * - "error": fetch/transport error (network, 5xx, CORS, parse)
 */
export type PublicPageResolution =
  | { status: "ok"; page: SitePage }
  | { status: "not-found" }
  | { status: "error"; error: string };

function logResolveError(scope: string, err: unknown, ctx: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.error(`[SiteRenderService:${scope}] fetch error`, { ...ctx, error: err });
}

/**
 * SiteRenderService — public resolution of site pages by domain or slug.
 * No business logic — pure read operations for rendering.
 */
export class SiteRenderService {
  /**
   * @deprecated Prefer resolveByDomainAndPathSafe to distinguish errors from not-found.
   */
  static async resolveByDomainAndPath(hostname: string, path: string): Promise<SitePage | null> {
    const r = await this.resolveByDomainAndPathSafe(hostname, path);
    return r.status === "ok" ? r.page : null;
  }

  /**
   * Resolve a page by domain + path with discriminated result.
   * - "/" → home page (is_home = true)
   * - "/slug" → match slug among pages bound to this domain
   * - Ambiguous slug (>1 match) → not-found + console.error
   * - Any supabase error → "error" (not silent null)
   */
  static async resolveByDomainAndPathSafe(hostname: string, path: string): Promise<PublicPageResolution> {
    try {
      const normalizedPath = path.replace(/\/+$/, '').replace(/^\//, '');

      if (!normalizedPath) {
        const { data: binding, error: bindError } = await (supabase
          .from("site_domain_bindings") as any)
          .select("site_page_id")
          .eq("domain", hostname)
          .eq("is_home", true)
          .maybeSingle();

        if (bindError) {
          logResolveError("resolveByDomainAndPath.binding-home", bindError, { hostname });
          return { status: "error", error: bindError.message || "binding fetch failed" };
        }
        if (!binding) return { status: "not-found" };

        const { data: page, error: pageError } = await (supabase
          .from("site_pages") as any)
          .select("*")
          .eq("id", binding.site_page_id)
          .eq("status", "published")
          .maybeSingle();

        if (pageError) {
          logResolveError("resolveByDomainAndPath.page-home", pageError, { hostname, pageId: binding.site_page_id });
          return { status: "error", error: pageError.message || "page fetch failed" };
        }
        if (!page) return { status: "not-found" };
        return { status: "ok", page: page as SitePage };
      }

      const { data: bindings, error: bindingsError } = await (supabase
        .from("site_domain_bindings") as any)
        .select("site_page_id")
        .eq("domain", hostname);

      if (bindingsError) {
        logResolveError("resolveByDomainAndPath.bindings", bindingsError, { hostname });
        return { status: "error", error: bindingsError.message || "bindings fetch failed" };
      }
      if (!bindings?.length) return { status: "not-found" };

      const pageIds = bindings.map((b: any) => b.site_page_id);
      const { data: pages, error: pagesError } = await (supabase
        .from("site_pages") as any)
        .select("*")
        .in("id", pageIds)
        .eq("slug", normalizedPath)
        .eq("status", "published");

      if (pagesError) {
        logResolveError("resolveByDomainAndPath.pages", pagesError, { hostname, slug: normalizedPath });
        return { status: "error", error: pagesError.message || "pages fetch failed" };
      }
      if (!pages || pages.length === 0) return { status: "not-found" };

      if (pages.length > 1) {
        // eslint-disable-next-line no-console
        console.error(`Ambiguous slug "${normalizedPath}" for domain "${hostname}": ${pages.length} pages found`);
        return { status: "not-found" };
      }

      return { status: "ok", page: pages[0] as SitePage };
    } catch (e: any) {
      logResolveError("resolveByDomainAndPath.exception", e, { hostname, path });
      return { status: "error", error: e?.message || String(e) };
    }
  }

  /** @deprecated Use resolveByDomainAndPath instead */
  static async resolveByDomain(hostname: string): Promise<SitePage | null> {
    return this.resolveByDomainAndPath(hostname, '/');
  }

  /** @deprecated Prefer resolveBySlugSafe to distinguish errors from not-found. */
  static async resolveBySlug(slug: string): Promise<SitePage | null> {
    const r = await this.resolveBySlugSafe(slug);
    return r.status === "ok" ? r.page : null;
  }

  static async resolveBySlugSafe(slug: string): Promise<PublicPageResolution> {
    try {
      const { data, error } = await (supabase
        .from("site_pages") as any)
        .select("*")
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle();

      if (error) {
        logResolveError("resolveBySlug", error, { slug });
        return { status: "error", error: error.message || "fetch failed" };
      }
      if (!data) return { status: "not-found" };
      return { status: "ok", page: data as SitePage };
    } catch (e: any) {
      logResolveError("resolveBySlug.exception", e, { slug });
      return { status: "error", error: e?.message || String(e) };
    }
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
