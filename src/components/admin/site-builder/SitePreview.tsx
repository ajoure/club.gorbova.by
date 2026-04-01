import { SitePageRenderer } from "@/components/site-renderer/SitePageRenderer";
import { useSitePricingData } from "@/hooks/useSitePricingData";
import type { SiteBlock } from "@/services/sitePages/types";

interface SitePreviewProps {
  blocks: SiteBlock[];
  themeSettings: Record<string, unknown>;
  pageId?: string;
}

export function SitePreview({ blocks, themeSettings, pageId }: SitePreviewProps) {
  const { pricingData } = useSitePricingData(blocks);
  return (
    <div className="bg-white min-h-full">
      <SitePageRenderer blocks={blocks} themeSettings={themeSettings} pricingData={pricingData} pageId={pageId} />
    </div>
  );
}
