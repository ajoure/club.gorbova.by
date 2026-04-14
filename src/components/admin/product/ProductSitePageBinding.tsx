/**
 * ProductSitePageBinding — compact card showing the canonical site page
 * linked to a product, pricing block diagnostics, and quick actions.
 *
 * Source of truth: site_pages.product_id (single FK, UNIQUE constraint).
 * Pricing readiness: resolveProductPageState (blocks inspection).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CopyableIdChip } from "@/components/ui/CopyableIdChip";
import { Globe, ExternalLink, Link2, Unlink, Copy, Plus, Minus, AlertTriangle, CheckCircle2, XCircle, Info } from "lucide-react";
import { toast } from "sonner";
import { getCanonicalPricingUrl, getCanonicalPageUrl } from "@/lib/productCanonicalUrl";
import { resolveProductPageState, getProductPageDiagnostic, type ProductPageDiagnostic } from "@/lib/resolveProductPageState";
import { copyToClipboard } from "@/utils/clipboardUtils";
import { slugify } from "@/utils/slugify";
import type { SiteBlock } from "@/services/sitePages/types";

interface ProductSitePageBindingProps {
  productId: string;
  primaryDomain?: string | null;
  productName?: string | null;
}

interface LinkedPageData {
  id: string;
  title: string;
  slug: string;
  product_id: string | null;
  status: string;
  blocks: SiteBlock[];
}

interface SitePageOption {
  id: string;
  title: string;
  slug: string;
  product_id: string | null;
}

export function ProductSitePageBinding({ productId, primaryDomain, productName }: ProductSitePageBindingProps) {
  const queryClient = useQueryClient();
  const [selectOpen, setSelectOpen] = useState(false);

  // Fetch the canonical page for this product (including blocks for pricing detection)
  const { data: linkedPage, isLoading: pageLoading } = useQuery({
    queryKey: ["product-site-page", productId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("site_pages") as any)
        .select("id, title, slug, product_id, status, blocks")
        .eq("product_id", productId)
        .maybeSingle();
      if (error) throw error;
      return data as LinkedPageData | null;
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

  // Resolve state
  const pageState = resolveProductPageState(
    linkedPage?.blocks,
    productId,
    !!linkedPage,
  );
  const diagnostic = getProductPageDiagnostic(pageState);

  // Bind page to product
  const bindMutation = useMutation({
    mutationFn: async (pageId: string) => {
      if (linkedPage?.id) {
        await (supabase.from("site_pages") as any)
          .update({ product_id: null })
          .eq("id", linkedPage.id);
      }
      const { error } = await (supabase.from("site_pages") as any)
        .update({ product_id: productId })
        .eq("id", pageId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
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
      invalidateAll();
      toast.success("Привязка снята");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Add pricing block to existing page
  const addPricingBlockMutation = useMutation({
    mutationFn: async () => {
      if (!linkedPage) throw new Error("Нет привязанной страницы");
      // Guard: don't duplicate
      if (pageState.pricingBlockMatchesProduct) {
        throw new Error("Блок тарифов этого продукта уже есть на странице");
      }
      const newBlock: SiteBlock = {
        id: crypto.randomUUID(),
        type: "pricing",
        version: 1,
        content: { product_id: productId, title: "", subtitle: "" },
        settings: {
          paddingTop: 0, paddingBottom: 0, backgroundColor: "", backgroundImage: "",
          textColor: "", fullWidth: false, maxWidth: "lg" as const,
          hideOnMobile: false, hideOnDesktop: false,
        },
        metadata: {},
      };
      const updatedBlocks = [...(linkedPage.blocks || []), newBlock];
      const { error } = await (supabase.from("site_pages") as any)
        .update({ blocks: updatedBlocks })
        .eq("id", linkedPage.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Блок тарифов добавлен на страницу");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Remove pricing block(s) from page
  const removePricingBlockMutation = useMutation({
    mutationFn: async () => {
      if (!linkedPage) throw new Error("Нет привязанной страницы");
      const blocks = linkedPage.blocks || [];
      const filtered = blocks.filter(
        (b) => !(b.type === "pricing" && (b.content as Record<string, unknown>)?.product_id === productId)
      );
      if (filtered.length === blocks.length) {
        throw new Error("Блок тарифов этого продукта не найден на странице");
      }
      const { error } = await (supabase.from("site_pages") as any)
        .update({ blocks: filtered })
        .eq("id", linkedPage.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Блок тарифов убран со страницы");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Create selling page with pricing block
  const createSellingPageMutation = useMutation({
    mutationFn: async () => {
      const baseSlug = slugify(productName || "product");
      // Check uniqueness
      const { data: existing } = await (supabase.from("site_pages") as any)
        .select("slug")
        .eq("slug", baseSlug)
        .maybeSingle();
      const finalSlug = existing ? `${baseSlug}-${Date.now().toString(36)}` : baseSlug;

      const pricingBlock: SiteBlock = {
        id: crypto.randomUUID(),
        type: "pricing",
        version: 1,
        content: { product_id: productId, title: "", subtitle: "" },
        settings: {
          paddingTop: 0, paddingBottom: 0, backgroundColor: "", backgroundImage: "",
          textColor: "", fullWidth: false, maxWidth: "lg" as const,
          hideOnMobile: false, hideOnDesktop: false,
        },
        metadata: {},
      };

      const { data: user } = await supabase.auth.getUser();
      if (!user?.user?.id) throw new Error("Not authenticated");

      const { error } = await (supabase.from("site_pages") as any).insert({
        title: productName || "Тарифы",
        slug: finalSlug,
        product_id: productId,
        blocks: [pricingBlock],
        status: "draft",
        created_by: user.user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Продающая страница создана");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["product-site-page", productId] });
    queryClient.invalidateQueries({ queryKey: ["site-pages"] });
  }

  const handleBind = (pageId: string) => {
    if (pageId === "__none") return;
    const page = allPages?.find(p => p.id === pageId);
    if (page?.product_id && page.product_id !== productId) {
      if (!confirm("Эта страница уже привязана к другому продукту. Перепривязать?")) return;
    }
    bindMutation.mutate(pageId);
  };

  // Canonical URLs — pricing URL only when ready
  const canonicalPageUrl = linkedPage
    ? getCanonicalPageUrl(linkedPage.slug, primaryDomain)
    : "";

  const canonicalPricingUrl = pageState.isPricingReady && linkedPage
    ? getCanonicalPricingUrl(linkedPage.slug, primaryDomain)
    : "";

  // Available pages: those without product_id or with this product's id
  const availablePages = (allPages || []).filter(
    p => !p.product_id || p.product_id === productId
  );

  if (pageLoading) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

        {linkedPage ? (
          <>
            <span className="text-muted-foreground">Страница:</span>
            <CopyableIdChip value={linkedPage.slug} copyValue={linkedPage.id} successMessage="ID скопирован" />

            {/* Page URL — always shown when linked */}
            {canonicalPageUrl && (
              <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
                <a href={canonicalPageUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            )}

            {/* Pricing URL — only when isPricingReady */}
            {canonicalPricingUrl && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[11px] gap-1 px-1.5"
                onClick={() => copyToClipboard(canonicalPricingUrl, "URL тарифов скопирован")}
              >
                <Copy className="h-3 w-3" />
                #tariffs
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
            <Select onValueChange={handleBind} onOpenChange={setSelectOpen}>
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
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[11px] gap-1 px-2"
              onClick={() => createSellingPageMutation.mutate()}
              disabled={createSellingPageMutation.isPending}
            >
              <Plus className="h-3 w-3" />
              Создать продающую
            </Button>
          </>
        )}
      </div>

      {/* Diagnostic status block */}
      <DiagnosticBadge
        diagnostic={diagnostic}
        onAddPricingBlock={() => addPricingBlockMutation.mutate()}
        isAdding={addPricingBlockMutation.isPending}
      />
    </div>
  );
}

function DiagnosticBadge({
  diagnostic,
  onAddPricingBlock,
  isAdding,
}: {
  diagnostic: ProductPageDiagnostic;
  onAddPricingBlock: () => void;
  isAdding: boolean;
}) {
  switch (diagnostic) {
    case "not_linked":
      return null; // handled by main UI above

    case "linked_no_pricing":
      return (
        <div className="flex items-center gap-2 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span>На странице нет блока тарифов</span>
          <Button
            variant="outline"
            size="sm"
            className="h-5 text-[10px] px-1.5 gap-1"
            onClick={onAddPricingBlock}
            disabled={isAdding}
          >
            <Plus className="h-3 w-3" />
            Добавить
          </Button>
        </div>
      );

    case "linked_pricing_mismatch":
      return (
        <div className="flex items-center gap-2 text-[11px] text-destructive">
          <XCircle className="h-3 w-3 shrink-0" />
          <span>Блок тарифов на странице указывает на другой продукт</span>
          <Button
            variant="outline"
            size="sm"
            className="h-5 text-[10px] px-1.5 gap-1"
            onClick={onAddPricingBlock}
            disabled={isAdding}
          >
            <Plus className="h-3 w-3" />
            Добавить свой
          </Button>
        </div>
      );

    case "linked_pricing_multiple":
      return (
        <div className="flex items-center gap-2 text-[11px] text-amber-600 dark:text-amber-400">
          <Info className="h-3 w-3 shrink-0" />
          <span>На странице несколько блоков тарифов этого продукта</span>
        </div>
      );

    case "linked_pricing_ready":
      return (
        <div className="flex items-center gap-2 text-[11px] text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3 w-3 shrink-0" />
          <span>Продающая страница готова</span>
        </div>
      );
  }
}
