/**
 * HtmlSection — public renderer for HTML blocks in site pages.
 *
 * Uses shared HtmlIframePreview for sandboxed rendering.
 * Data mapping: content.code → html prop (backward compatible).
 *
 * ISOLATION INVARIANT:
 *   HTML block content is rendered in a sandboxed iframe without allow-same-origin.
 *   No access to parent DOM, cookies, localStorage, or platform services.
 *   TextSection and ColumnsSection remain on their sanitized fragment path — unaffected.
 */

import { HtmlIframePreview } from "@/components/shared/HtmlIframePreview";

interface HtmlSectionProps {
  content: Record<string, unknown>;
}

export function HtmlSection({ content }: HtmlSectionProps) {
  const code = (content.code as string) || "";
  if (!code) return null;

  return (
    <section className="py-6 px-6">
      <div className="max-w-4xl mx-auto">
        <HtmlIframePreview html={code} />
      </div>
    </section>
  );
}
