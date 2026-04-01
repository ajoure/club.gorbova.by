/**
 * SitePageBySlug — thin public resolution layer.
 */

import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { SiteRenderService } from "@/services/sitePages/SiteRenderService";
import { SitePageRenderer } from "@/components/site-renderer/SitePageRenderer";
import { useSitePricingData } from "@/hooks/useSitePricingData";
import type { SiteBlock } from "@/services/sitePages/types";
import NotFound from "./NotFound";

export default function SitePageBySlug() {
  const { slug } = useParams<{ slug: string }>();

  const { data: page, isLoading } = useQuery({
    queryKey: ["site-page-public", slug],
    queryFn: () => SiteRenderService.resolveBySlug(slug!),
    enabled: !!slug,
  });

  const blocks = (page?.blocks as unknown as SiteBlock[]) || [];
  const { pricingData } = useSitePricingData(blocks);

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
        blocks={blocks}
        themeSettings={page.theme_settings || {}}
        pricingData={pricingData}
        pageId={page.id}
      />
    </div>
  );
}
