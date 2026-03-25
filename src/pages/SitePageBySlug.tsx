/**
 * SitePageBySlug — thin public resolution layer.
 *
 * Compatibility rules:
 * - This route is strictly a public slug resolution layer, NOT a default routing mechanism.
 * - Slug is used only as a public URL attribute; all internal refs remain UUID-driven.
 * - No route-level business logic — delegates entirely to SiteRenderService.
 * - Explicit static routes always take priority over this dynamic /:slug route.
 */

import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { SiteRenderService } from "@/services/sitePages/SiteRenderService";
import { SitePageRenderer } from "@/components/site-renderer/SitePageRenderer";
import type { SiteBlock } from "@/services/sitePages/types";
import NotFound from "./NotFound";

export default function SitePageBySlug() {
  const { slug } = useParams<{ slug: string }>();

  const { data: page, isLoading } = useQuery({
    queryKey: ["site-page-public", slug],
    queryFn: () => SiteRenderService.resolveBySlug(slug!),
    enabled: !!slug,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!page) {
    return <NotFound />;
  }

  return (
    <div className="site-public-layout">
      <SitePageRenderer
        blocks={(page.blocks as unknown as SiteBlock[]) || []}
        themeSettings={page.theme_settings || {}}
      />
    </div>
  );
}
