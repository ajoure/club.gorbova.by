import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSiteDomainBindings } from "@/hooks/useSiteDomainBindings";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Globe, Home } from "lucide-react";
import { useState, useEffect } from "react";
import { normalizeDomain } from "@/services/sitePages/domainUtils";
import { Badge } from "@/components/ui/badge";
import { CopyableIdChip } from "@/components/ui/CopyableIdChip";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface SiteSettingsPanelProps {
  pageId: string;
  title: string;
  slug: string;
  seoSettings: Record<string, unknown>;
  themeSettings: Record<string, unknown>;
  onTitleChange: (v: string) => void;
  onSlugChange: (v: string) => void;
  onSeoChange: (v: Record<string, unknown>) => void;
  onThemeChange: (v: Record<string, unknown>) => void;
}

export function SiteSettingsPanel({
  pageId, title, slug, seoSettings, themeSettings,
  onTitleChange, onSlugChange, onSeoChange, onThemeChange,
}: SiteSettingsPanelProps) {
  const queryClient = useQueryClient();
  const { bindings, bindDomain, unbindDomain, setHome, isBinding, isSettingHome } = useSiteDomainBindings(pageId);
  const [newDomain, setNewDomain] = useState("");

  // Fetch current product binding for this page
  const { data: currentPage } = useQuery({
    queryKey: ["site-page-product-binding", pageId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("site_pages") as any)
        .select("id, product_id")
        .eq("id", pageId)
        .single();
      if (error) throw error;
      return data as { id: string; product_id: string | null };
    },
    enabled: !!pageId,
  });

  // Fetch products for dropdown
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const { data: products } = useQuery({
    queryKey: ["products-for-page-binding"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as { id: string; name: string }[];
    },
    enabled: productDropdownOpen,
  });

  const bindProductMutation = useMutation({
    mutationFn: async (newProductId: string | null) => {
      const { error } = await (supabase.from("site_pages") as any)
        .update({ product_id: newProductId })
        .eq("id", pageId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-page-product-binding", pageId] });
      queryClient.invalidateQueries({ queryKey: ["product-site-page"] });
      queryClient.invalidateQueries({ queryKey: ["site-pages"] });
      toast.success("Привязка обновлена");
    },
    onError: (e: Error) => {
      if (e.message?.includes("idx_site_pages_product_id_unique")) {
        toast.error("Этот продукт уже привязан к другой странице");
      } else {
        toast.error(e.message);
      }
    },
  });

  const handleProductChange = (value: string) => {
    if (value === "__none") {
      bindProductMutation.mutate(null);
    } else {
      bindProductMutation.mutate(value);
    }
  };

  const handleAddDomain = () => {
    if (!newDomain.trim()) return;
    try {
      const normalized = normalizeDomain(newDomain);
      bindDomain(normalized);
      setNewDomain("");
    } catch {
      // normalizeDomain throws if empty after cleanup
    }
  };

  const handleDomainInput = (value: string) => {
    // Strip protocol/path on paste
    let cleaned = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    setNewDomain(cleaned);
  };

  const handleUnbind = (binding: typeof bindings[0]) => {
    if (binding.is_home) {
      if (!confirm("Это главная страница домена. После удаления корневой адрес (/) будет отдавать 404. Продолжить?")) {
        return;
      }
    }
    unbindDomain(binding.id);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* General */}
      <Card>
        <CardHeader><CardTitle className="text-base">Основные</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Название</Label>
            <Input value={title} onChange={(e) => onTitleChange(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Адрес страницы</Label>
            <Input
              value={slug}
              onChange={(e) => onSlugChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            />
            {bindings.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                URL: {bindings[0].domain}/<strong>{slug || "..."}</strong>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Привяжите домен, чтобы увидеть URL страницы
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* SEO */}
      <Card>
        <CardHeader><CardTitle className="text-base">SEO</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>SEO-заголовок (Meta Title)</Label>
            <Input
              value={(seoSettings.title as string) || ""}
              onChange={(e) => onSeoChange({ ...seoSettings, title: e.target.value })}
              placeholder="Заголовок страницы для поисковиков"
            />
          </div>
          <div className="space-y-2">
            <Label>SEO-описание (Meta Description)</Label>
            <Textarea
              value={(seoSettings.description as string) || ""}
              onChange={(e) => onSeoChange({ ...seoSettings, description: e.target.value })}
              placeholder="Описание страницы"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>Картинка для соцсетей (OG Image URL)</Label>
            <Input
              value={(seoSettings.og_image as string) || ""}
              onChange={(e) => onSeoChange({ ...seoSettings, og_image: e.target.value })}
              placeholder="https://..."
            />
          </div>
        </CardContent>
      </Card>

      {/* Theme */}
      <Card>
        <CardHeader><CardTitle className="text-base">Тема</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Основной цвет</Label>
            <Input
              value={(themeSettings.primary_color as string) || ""}
              onChange={(e) => onThemeChange({ ...themeSettings, primary_color: e.target.value })}
              placeholder="#4F46E5"
            />
          </div>
          <div className="space-y-2">
            <Label>Шрифт</Label>
            <Input
              value={(themeSettings.font_family as string) || ""}
              onChange={(e) => onThemeChange({ ...themeSettings, font_family: e.target.value })}
              placeholder="Inter, sans-serif"
            />
          </div>
        </CardContent>
      </Card>

      {/* Domain Bindings */}
      <Card>
        <CardHeader><CardTitle className="text-base">Привязка доменов</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {bindings.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 p-2 border rounded">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{b.domain}</span>
                {b.is_home && (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <Home className="h-3 w-3" />
                    Главная
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {!b.is_home && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={isSettingHome}
                    onClick={() => setHome({ domain: b.domain, targetPageId: pageId })}
                  >
                    <Home className="h-3 w-3 mr-1" />
                    Сделать главной
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleUnbind(b)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              value={newDomain}
              onChange={(e) => handleDomainInput(e.target.value)}
              placeholder="example.gorbova.by"
              className="flex-1"
            />
            <Button onClick={handleAddDomain} disabled={isBinding || !newDomain.trim()} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Привязать
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Product Binding */}
      <Card>
        <CardHeader><CardTitle className="text-base">Привязанный продукт</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs">Продукт</Label>
            <Select
              value={currentPage?.product_id || "__none"}
              onValueChange={handleProductChange}
              onOpenChange={setProductDropdownOpen}
            >
              <SelectTrigger>
                <SelectValue placeholder="Не привязан" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Не привязан</SelectItem>
                {(products || []).map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {currentPage?.product_id && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">ID продукта:</span>
              <CopyableIdChip value={currentPage.product_id.slice(0, 8) + "…"} copyValue={currentPage.product_id} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Страница ID: <CopyableIdChip value={pageId.slice(0, 8) + "…"} copyValue={pageId} />
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
