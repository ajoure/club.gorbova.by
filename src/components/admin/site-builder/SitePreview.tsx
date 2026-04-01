import { SitePageRenderer } from "@/components/site-renderer/SitePageRenderer";
import type { SiteBlock } from "@/services/sitePages/types";

interface SitePreviewProps {
  blocks: SiteBlock[];
  themeSettings: Record<string, unknown>;
  pageId?: string;
}

export function SitePreview({ blocks, themeSettings, pageId }: SitePreviewProps) {
  return (
    <div className="bg-white min-h-full">
      <SitePageRenderer blocks={blocks} themeSettings={themeSettings} pageId={pageId} />
    </div>
  );
}
