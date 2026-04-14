/**
 * SitePageBySlug — thin public resolution layer.
 */

import { useEffect, useRef } from "react";
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
  const hashScrolled = useRef(false);

  const { data: page, isLoading } = useQuery({
    queryKey: ["site-page-public", slug],
    queryFn: () => SiteRenderService.resolveBySlug(slug!),
    enabled: !!slug,
  });

  const blocks = (page?.blocks as unknown as SiteBlock[]) || [];
  const { pricingData } = useSitePricingData(blocks);

  // Scroll to hash anchor after page + pricing data loaded
  useEffect(() => {
    if (!page || hashScrolled.current) return;
    const hash = window.location.hash?.replace("#", "");
    if (!hash) return;

    // Support legacy #prices alias → scroll to #tariffs
    const targetId = hash === "prices" ? "tariffs" : hash;

    const tryScroll = () => {
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
        hashScrolled.current = true;
        return true;
      }
      return false;
    };

    // Retry with delays to wait for pricing data render
    const t1 = setTimeout(tryScroll, 300);
    const t2 = setTimeout(tryScroll, 800);
    const t3 = setTimeout(tryScroll, 1500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [page, pricingData]);

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
