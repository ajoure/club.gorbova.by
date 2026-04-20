import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { RichTextarea } from "@/components/ui/RichTextarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import type { PublicProductData, PublicTariff } from "@/hooks/usePublicProduct";

interface PricingBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

interface ProductOption {
  id: string;
  name: string;
}

type FilterMode = "all" | "selected";

export function PricingBlockEditor({ content, onChange }: PricingBlockEditorProps) {
  const [products, setProducts] = useState<ProductOption[]>([]);

  useEffect(() => {
    supabase
      .from("products_v2")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        if (data) setProducts(data);
      });
  }, []);

  const productId = (content.product_id as string) || "";
  const filterMode: FilterMode = ((content.tariff_filter_mode as FilterMode) || "all");
  const tariffIds = (content.tariff_ids as string[]) || [];

  // Load tariffs for the selected product (same EF as renderer — single source of truth)
  const { data: productData, isLoading: isTariffsLoading, isFetching: isTariffsFetching } = useQuery({
    queryKey: ["pricing-editor-product", productId],
    queryFn: async (): Promise<PublicProductData | null> => {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-product?product_id=${encodeURIComponent(productId)}`;
      const r = await fetch(url, {
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
      });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!productId,
    staleTime: 1000 * 60 * 5,
  });

  const tariffs: PublicTariff[] = productData?.tariffs ?? [];
  const tariffsPending = isTariffsLoading || (isTariffsFetching && !productData);

  const handleProductChange = (newProductId: string) => {
    // ID-first: reset filter on product change to prevent stale UUID references
    onChange({
      ...content,
      product_id: newProductId,
      tariff_ids: [],
      tariff_filter_mode: "all",
    });
  };

  const handleModeChange = (mode: FilterMode) => {
    onChange({ ...content, tariff_filter_mode: mode });
  };

  const toggleTariff = (id: string, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...tariffIds, id]))
      : tariffIds.filter((t) => t !== id);
    onChange({ ...content, tariff_ids: next });
  };

  const selectAll = () => {
    onChange({ ...content, tariff_ids: tariffs.map((t) => t.id) });
  };

  const clearAll = () => {
    onChange({ ...content, tariff_ids: [] });
  };

  const showSelectedEmpty = filterMode === "selected" && tariffIds.length === 0;

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Продукт</Label>
        <Select value={productId} onValueChange={handleProductChange}>
          <SelectTrigger><SelectValue placeholder="Выберите продукт" /></SelectTrigger>
          <SelectContent>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">Заголовок секции</Label>
        <RichTextarea
          inline
          value={(content.title as string) || ""}
          onChange={(v) => onChange({ ...content, title: v })}
          placeholder="Тарифы"
        />
      </div>
      <div>
        <Label className="text-xs">Подзаголовок</Label>
        <RichTextarea
          inline
          value={(content.subtitle as string) || ""}
          onChange={(v) => onChange({ ...content, subtitle: v })}
          placeholder="Выберите подходящий тариф"
        />
      </div>

      {/* Tariff filter — only when product is selected */}
      {productId && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <Label className="text-xs">Какие тарифы показывать</Label>
          <RadioGroup
            value={filterMode}
            onValueChange={(v) => handleModeChange(v as FilterMode)}
            className="flex gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="all" id="tariff-mode-all" />
              <Label htmlFor="tariff-mode-all" className="text-xs cursor-pointer">Все тарифы</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="selected" id="tariff-mode-selected" />
              <Label htmlFor="tariff-mode-selected" className="text-xs cursor-pointer">Выбранные</Label>
            </div>
          </RadioGroup>

          {filterMode === "selected" && (
            <div className="space-y-2 pt-2">
              {tariffsPending ? (
                <p className="text-xs text-muted-foreground">Загрузка тарифов…</p>
              ) : tariffs.length === 0 ? (
                <p className="text-xs text-muted-foreground">У продукта нет активных тарифов.</p>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={selectAll}>
                      Выбрать все
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={clearAll}>
                      Снять все
                    </Button>
                  </div>
                  <div className="space-y-1.5">
                    {tariffs.map((t) => {
                      const checked = tariffIds.includes(t.id);
                      return (
                        <label
                          key={t.id}
                          className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 cursor-pointer min-w-0"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => toggleTariff(t.id, v === true)}
                            className="shrink-0 mt-0.5"
                          />
                          <span className="text-sm flex-1 min-w-0 break-words">{t.name}</span>
                          {t.is_popular && (
                            <Badge variant="secondary" className="text-xs shrink-0 whitespace-nowrap self-start">
                              Популярный
                            </Badge>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  {showSelectedEmpty && (
                    <Alert variant="destructive" className="py-2">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <AlertDescription className="text-xs">
                        Не выбрано ни одного тарифа — блок не будет отображаться на странице.
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
