/**
 * Embed Form Page — публичная страница для встраивания формы конструктора сайтов.
 *
 * Reuse 1:1:
 * - canonical FormSection renderer (тот же, что на site page)
 * - canonical site-form-submit edge function (CORS=*)
 * - canonical contact-resolve и dedup
 *
 * Route: /embed/form/:pageId/:blockId
 *  - pageId — site_pages.id (canonical)
 *  - blockId — stable block.id формы (UUID)
 *
 * Передаётся в metadata как embed_origin/embed_block_id для трассировки.
 */
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Loader2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FormSection } from "@/components/site-renderer/blocks/FormSection";

interface PageBlock {
  id: string;
  type: string;
  content: Record<string, unknown>;
}

export default function EmbedFormPage() {
  const { pageId, blockId } = useParams<{ pageId: string; blockId: string }>();
  const [searchParams] = useSearchParams();
  const embedOrigin = searchParams.get("origin") || "";

  const [loading, setLoading] = useState(true);
  const [block, setBlock] = useState<PageBlock | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pageId || !blockId) {
      setError("Неверная ссылка");
      setLoading(false);
      return;
    }
    (async () => {
      const { data, error: e } = await supabase
        .from("site_pages")
        .select("id, blocks, status")
        .eq("id", pageId)
        .maybeSingle();
      if (e || !data) {
        setError("Страница не найдена");
        setLoading(false);
        return;
      }
      const blocks = (data.blocks as unknown as PageBlock[]) || [];
      const found = blocks.find((b) => b.id === blockId && b.type === "form");
      if (!found) {
        setError("Форма не найдена на странице");
        setLoading(false);
        return;
      }
      // Inject embed metadata into content so FormSection / submit передаст в metadata
      const enrichedContent = {
        ...found.content,
        __embed_origin: embedOrigin || null,
        __embed_block_id: blockId,
      };
      setBlock({ ...found, content: enrichedContent });
      setLoading(false);
    })();
  }, [pageId, blockId, embedOrigin]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !block) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center space-y-2">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
          <p className="text-sm text-muted-foreground">{error || "Не удалось загрузить форму"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <FormSection content={block.content} pageId={pageId} />
    </div>
  );
}
