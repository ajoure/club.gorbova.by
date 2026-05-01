import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X, Info } from "lucide-react";

export interface AccessRuleRow {
  product_id: string;
  tariff_ids: string[]; // empty = all tariffs
  match_purchase_month?: boolean;
}

interface LiveEventAccessRulesEditorProps {
  rules: AccessRuleRow[];
  onChange: (rules: AccessRuleRow[]) => void;
}

export function LiveEventAccessRulesEditor({ rules, onChange }: LiveEventAccessRulesEditorProps) {
  const { data: products } = useQuery({
    queryKey: ["live-access-products"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products_v2")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  const usedProductIds = rules.filter(r => r.tariff_ids.length === 0).map(r => r.product_id);

  const addRule = () => {
    onChange([...rules, { product_id: "", tariff_ids: [] }]);
  };

  const removeRule = (index: number) => {
    onChange(rules.filter((_, i) => i !== index));
  };

  const updateProduct = (index: number, productId: string) => {
    // Check if this product already has "all tariffs" rule
    const existingAll = rules.findIndex((r, i) => i !== index && r.product_id === productId && r.tariff_ids.length === 0);
    if (existingAll >= 0) return; // prevent duplicate

    const updated = [...rules];
    updated[index] = { product_id: productId, tariff_ids: [] };
    onChange(updated);
  };

  const updateTariffs = (index: number, tariffIds: string[]) => {
    const updated = [...rules];
    updated[index] = { ...updated[index], tariff_ids: tariffIds };
    onChange(updated);
  };

  // Build audience preview text
  const previewText = buildPreviewText(rules, products || []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Кто может войти</Label>
      </div>

      {rules.length === 0 && (
        <p className="text-sm text-muted-foreground italic">
          Правила доступа не заданы. Добавьте хотя бы одно правило.
        </p>
      )}

      {rules.map((rule, index) => (
        <RuleRow
          key={index}
          rule={rule}
          index={index}
          products={products || []}
          usedProductIds={usedProductIds}
          onUpdateProduct={updateProduct}
          onUpdateTariffs={updateTariffs}
          onRemove={removeRule}
        />
      ))}

      <Button variant="outline" size="sm" onClick={addRule} className="gap-1.5">
        <Plus className="h-3.5 w-3.5" />
        Добавить правило
      </Button>

      {previewText && (
        <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
          <span>{previewText}</span>
        </div>
      )}
    </div>
  );
}

interface RuleRowProps {
  rule: AccessRuleRow;
  index: number;
  products: Array<{ id: string; name: string }>;
  usedProductIds: string[];
  onUpdateProduct: (index: number, productId: string) => void;
  onUpdateTariffs: (index: number, tariffIds: string[]) => void;
  onRemove: (index: number) => void;
}

function RuleRow({ rule, index, products, usedProductIds, onUpdateProduct, onUpdateTariffs, onRemove }: RuleRowProps) {
  const { data: tariffs } = useQuery({
    queryKey: ["live-access-tariffs", rule.product_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("tariffs")
        .select("id, name")
        .eq("product_id", rule.product_id)
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
    enabled: !!rule.product_id,
  });

  const [tariffSelectOpen, setTariffSelectOpen] = useState(false);

  const toggleTariff = (tariffId: string) => {
    const current = rule.tariff_ids;
    if (current.includes(tariffId)) {
      onUpdateTariffs(index, current.filter(id => id !== tariffId));
    } else {
      onUpdateTariffs(index, [...current, tariffId]);
    }
  };

  const availableProducts = products.filter(
    p => p.id === rule.product_id || !usedProductIds.includes(p.id)
  );

  return (
    <div className="flex items-start gap-2 p-3 rounded-lg border bg-background">
      <div className="flex-1 space-y-2">
        <Select value={rule.product_id} onValueChange={(v) => onUpdateProduct(index, v)}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Выберите продукт" />
          </SelectTrigger>
          <SelectContent className="max-h-[60vh] overflow-y-auto">
            {availableProducts.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {rule.product_id && tariffs && tariffs.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              {rule.tariff_ids.length === 0 ? "Все тарифы" : `Тарифы: ${rule.tariff_ids.length}`}
            </p>
            <div className="flex flex-wrap gap-1">
              {tariffs.map(t => {
                const selected = rule.tariff_ids.includes(t.id);
                return (
                  <Badge
                    key={t.id}
                    variant={selected ? "default" : "outline"}
                    className="cursor-pointer text-xs"
                    onClick={() => toggleTariff(t.id)}
                  >
                    {t.name}
                  </Badge>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {rule.tariff_ids.length === 0
                ? "Доступ по любому тарифу этого продукта"
                : "Доступ только по выбранным тарифам"}
            </p>
          </div>
        )}
      </div>
      <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => onRemove(index)}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function buildPreviewText(
  rules: AccessRuleRow[],
  products: Array<{ id: string; name: string }>
): string | null {
  const validRules = rules.filter(r => r.product_id);
  if (validRules.length === 0) return null;

  const parts = validRules.map(rule => {
    const product = products.find(p => p.id === rule.product_id);
    const pName = product?.name || "Неизвестный продукт";
    if (rule.tariff_ids.length === 0) {
      return pName;
    }
    return `${pName} (выбранные тарифы)`;
  });

  return `Итог: доступ у пользователей продуктов: ${parts.join(", ")}`;
}
