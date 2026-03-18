import { SitePageRenderer } from "@/components/site-renderer/SitePageRenderer";
import type { SiteBlock } from "@/services/sitePages/types";

interface SitePreviewProps {
  blocks: SiteBlock[];
  themeSettings: Record<string, unknown>;
}

export function SitePreview({ blocks, themeSettings }: SitePreviewProps) {
  return (
    <div className="bg-white min-h-full">
      <SitePageRenderer blocks={blocks} themeSettings={themeSettings} />
    </div>
  );
}
