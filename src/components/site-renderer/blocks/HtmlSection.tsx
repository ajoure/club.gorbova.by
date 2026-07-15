/**
 * HtmlSection — public renderer for HTML blocks in site pages.
 *
 * Uses shared HtmlIframePreview for sandboxed rendering. When the page provides
 * a SiteSlotManifest via context, it is forwarded to the iframe bridge (v8) so
 * data-lovable-slot buttons pick up dynamic labels/visibility/UUIDs. pageId and
 * blockId are echoed as manifest provenance for click-time validation.
 */

import { HtmlIframePreview } from "@/components/shared/HtmlIframePreview";
import { useSiteSlotManifest } from "@/contexts/SiteSlotManifestContext";

interface HtmlSectionProps {
  content: Record<string, unknown>;
  pageId?: string | null;
  blockId?: string | null;
}

export function HtmlSection({ content, pageId = null, blockId = null }: HtmlSectionProps) {
  const code = (content.code as string) || "";
  const manifest = useSiteSlotManifest();
  if (!code) return null;

  return (
    <section>
      <HtmlIframePreview html={code} slotManifest={manifest} pageId={pageId} blockId={blockId} />
    </section>
  );
}
