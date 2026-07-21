import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { validateProductPageAddress } from "@/lib/productPageAddress";
import type { SiteBlock } from "./types";

export interface ProductSitePageSummary {
  id: string;
  slug: string;
  title: string;
  status: string;
}

function pricingBlock(productId: string): SiteBlock {
  return {
    id: crypto.randomUUID(),
    type: "pricing",
    version: 1,
    content: { product_id: productId, title: "", subtitle: "" },
    settings: {
      paddingTop: 0,
      paddingBottom: 0,
      backgroundColor: "",
      backgroundImage: "",
      textColor: "",
      fullWidth: false,
      maxWidth: "lg",
      hideOnMobile: false,
      hideOnDesktop: false,
    },
    metadata: {},
  };
}

export async function getProductSitePage(productId: string): Promise<ProductSitePageSummary | null> {
  const { data, error } = await supabase.from("site_pages")
    .select("id, slug, title, status")
    .eq("product_id", productId)
    .maybeSingle();
  if (error) throw error;
  return data as ProductSitePageSummary | null;
}

export async function assertProductPageSlugAvailable(slug: string, currentPageId?: string): Promise<void> {
  const [pageResult, aliasResult] = await Promise.all([
    supabase.from("site_pages").select("id").eq("slug", slug).maybeSingle(),
    supabase.from("site_page_slug_aliases").select("site_page_id").eq("slug", slug).maybeSingle(),
  ]);

  if (pageResult.error) throw pageResult.error;
  if (aliasResult.error) throw aliasResult.error;
  if (pageResult.data && pageResult.data.id !== currentPageId) {
    throw new Error(`Адрес /${slug} уже занят другой страницей`);
  }
  if (aliasResult.data && aliasResult.data.site_page_id !== currentPageId) {
    throw new Error(`Адрес /${slug} сохранён как старый адрес другой страницы`);
  }
}

export async function saveProductPageAddress(args: {
  productId: string;
  productName: string;
  address: string;
}): Promise<ProductSitePageSummary> {
  const validation = validateProductPageAddress(args.address);
  if (!validation.ok) throw new Error(validation.error);

  const existing = await getProductSitePage(args.productId);
  await assertProductPageSlugAvailable(validation.slug, existing?.id);

  if (existing) {
    if (existing.slug === validation.slug) return existing;
    const { data, error } = await supabase.from("site_pages")
      .update({ slug: validation.slug })
      .eq("id", existing.id)
      .select("id, slug, title, status")
      .single();
    if (error) throw error;
    return data as ProductSitePageSummary;
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user?.id) throw new Error("Не удалось определить администратора");

  const { data, error } = await supabase.from("site_pages")
    .insert({
      title: args.productName || "Тарифы",
      slug: validation.slug,
      product_id: args.productId,
      blocks: [pricingBlock(args.productId)] as unknown as Json,
      status: "draft",
      created_by: authData.user.id,
    })
    .select("id, slug, title, status")
    .single();
  if (error) throw error;
  return data as ProductSitePageSummary;
}
