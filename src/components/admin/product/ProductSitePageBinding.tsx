/**
 * ProductSitePageBinding — compact card showing the canonical site page
 * linked to a product and allowing to bind/unbind pages.
 * Source of truth: site_pages.product_id (single FK, UNIQUE constraint).
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CopyableIdChip } from "@/components/ui/CopyableIdChip";
import { Globe, ExternalLink, Link2, Unlink, Copy } from "lucide-react";
import { toast } from "sonner";
import { getCanonicalPricingUrl, getCanonicalPageUrl } from "@/lib/productCanonicalUrl";
import { copyToClipboard } from "@/utils/clipboardUtils";

interface ProductSitePageBindingProps {
  productId: string;
  primaryDomain?: string | null;
}

interface SitePageOption {
  id: string;
  title: string;
  slug: string;
  product_id: string | null;
}

export function ProductSitePageBinding({ productId, primaryDomain }: ProductSitePageBindingProps) {
  const queryClient = useQueryClient();
  const [selectOpen, setSelectOpen] = useState(false);

  // Fetch the canonical page for this product
  const { data: linkedPage, isLoading: pageLoading } = useQuery({
    queryKey: ["product-site-page", productId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("site_pages") as any)
        .select("id, title, slug, product_id, status")
        .eq("product_id", productId)
        .maybeSingle();
      if (error) throw error;
      return data as SitePageOption | null;
    },
    enabled: !!productId,
  });

  // Fetch all site pages for the dropdown
  const { data: allPages } = useQuery({
    queryKey: ["site-pages-for-binding"],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("site_pages") as any)
        .select("id, title, slug, product_id")
        .order("title");
      if (error) throw error;
      return (data || []) as SitePageOption[];
    },
    enabled: selectOpen,
  });

  // Bind page to product
  const bindMutation = useMutation({
    mutationFn: async (pageId: string) => {
      // First unbind any existing page for this product
      if (linkedPage?.id) {
        await (supabase.from("site_pages") as any)
          .update({ product_id: null })
          .eq("id", linkedPage.id);
      }
      // Bind new page
      const { error } = await (supabase.from("site_pages") as any)
        .update({ product_id: productId })
        .eq("id", pageId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product-site-page", productId] });
      queryClient.invalidateQueries({ queryKey: ["site-pages"] });
      toast.success("Страница привязана");
    },
    onError: (e: Error) => {
      if (e.message?.includes("idx_site_pages_product_id_unique")) {
        toast.error("Этот продукт уже привязан к другой странице");
      } else {
        toast.error(e.message);
      }
    },
  });

  // Unbind page from product
  const unbindMutation = useMutation({
    mutationFn: async () => {
      if (!linkedPage?.id) return;
      const { error } = await (supabase.from("site_pages") as any)
        .update({ product_id: null })
        .eq("id", linkedPage.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product-site-page", productId] });
      queryClient.invalidateQueries({ queryKey: ["site-pages"] });
      toast.success("Привязка снята");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleBind = (pageId: string) => {
    if (pageId === "__none") return;
    // Check if the selected page already has a different product
    const page = allPages?.find(p => p.id === pageId);
    if (page?.product_id && page.product_id !== productId) {
      if (!confirm("Эта страница уже привязана к другому продукту. Перепривязать?")) return;
    }
    bindMutation.mutate(pageId);
  };

  const canonicalPricingUrl = linkedPage
    ? getCanonicalPricingUrl(linkedPage.slug, primaryDomain)
    : getCanonicalPricingUrl(null, primaryDomain);

  const canonicalPageUrl = linkedPage
    ? getCanonicalPageUrl(linkedPage.slug, primaryDomain)
    : "";

  // Available pages: those without product_id or with this product's id
  const availablePages = (allPages || []).filter(
    p => !p.product_id || p.product_id === productId
  );

  if (pageLoading) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

      {linkedPage ? (
        <>
          <span className="text-muted-foreground">Страница:</span>
          <CopyableIdChip value={linkedPage.slug} copyValue={linkedPage.id} successMessage="ID скопирован" />
          {canonicalPricingUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] gap-1 px-1.5"
              onClick={() => copyToClipboard(canonicalPricingUrl, "URL скопирован")}
            >
              <Copy className="h-3 w-3" />
              #tariffs
            </Button>
          )}
          {canonicalPageUrl && (
            <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
              <a href={canonicalPageUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={() => unbindMutation.mutate()}
            disabled={unbindMutation.isPending}
          >
            <Unlink className="h-3 w-3" />
          </Button>
        </>
      ) : (
        <>
          <span className="text-muted-foreground">Нет привязанной страницы</span>
          <Select
            onValueChange={handleBind}
            onOpenChange={setSelectOpen}
          >
            <SelectTrigger className="h-6 w-auto min-w-[140px] text-[11px]">
              <SelectValue placeholder="Привязать…" />
            </SelectTrigger>
            <SelectContent>
              {availablePages.map(p => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.title} <span className="text-muted-foreground ml-1">/{p.slug}</span>
                </SelectItem>
              ))}
              {availablePages.length === 0 && (
                <div className="px-2 py-1 text-xs text-muted-foreground">Нет доступных страниц</div>
              )}
            </SelectContent>
          </Select>
        </>
      )}
    </div>
  );
}
