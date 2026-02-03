import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  ShoppingCart, 
  Plus, 
  Trash2, 
  DollarSign,
  Clock,
  Tag 
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SaleConfig {
  enabled: boolean;
  basePrice: number;
  accessDuration: 'forever' | 'days' | 'period';
  accessDays?: number;
  priceRules: PriceRule[];
}

interface PriceRule {
  id: string;
  tariffId: string;
  price: number;
}

interface LessonSaleConfigProps {
  config: SaleConfig;
  onChange: (config: SaleConfig) => void;
}

export const defaultSaleConfig: SaleConfig = {
  enabled: false,
  basePrice: 0,
  accessDuration: 'forever',
  accessDays: 30,
  priceRules: [],
};

export function LessonSaleConfig({ config, onChange }: LessonSaleConfigProps) {
  // Fetch products with tariffs for price rules
  const { data: productsWithTariffs } = useQuery({
    queryKey: ["products-tariffs-for-pricing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, name, tariffs(id, name, is_active)")
        .eq("is_active", true)
        .order("name");
      
      if (error) throw error;
      
      return data?.map((p) => ({
        id: p.id,
        name: p.name,
        tariffs: (p.tariffs as any[])
          ?.filter((t) => t.is_active)
          .map((t) => ({ id: t.id, name: t.name })) || [],
      })) || [];
    },
    enabled: config.enabled,
  });

  // Flatten tariffs for dropdown
  const allTariffs = productsWithTariffs?.flatMap((p) => 
    p.tariffs.map((t) => ({
      id: t.id,
      name: t.name,
      productName: p.name,
      label: `${p.name} → ${t.name}`,
    }))
  ) || [];

  // Add price rule
  const addPriceRule = () => {
    const newRule: PriceRule = {
      id: crypto.randomUUID(),
      tariffId: "",
      price: 0,
    };
    onChange({
      ...config,
      priceRules: [...config.priceRules, newRule],
    });
  };

  // Update price rule
  const updatePriceRule = (id: string, updates: Partial<PriceRule>) => {
    onChange({
      ...config,
      priceRules: config.priceRules.map((r) =>
        r.id === id ? { ...r, ...updates } : r
      ),
    });
  };

  // Remove price rule
  const removePriceRule = (id: string) => {
    onChange({
      ...config,
      priceRules: config.priceRules.filter((r) => r.id !== id),
    });
  };

  return (
    <div className={cn(
      "space-y-4 rounded-xl border border-border/40 p-4",
      "backdrop-blur-xl bg-card/40 dark:bg-card/30",
      "shadow-sm"
    )}>
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-primary" />
          <Label className="font-medium">Продавать этот урок отдельно</Label>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(v) => onChange({ ...config, enabled: v })}
        />
      </div>

      {config.enabled && (
        <div className="space-y-4 animate-in fade-in-50 duration-200">
          {/* Base price */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              Базовая цена (для всех без доступа)
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                step={0.01}
                value={config.basePrice || ""}
                onChange={(e) => onChange({ 
                  ...config, 
                  basePrice: parseFloat(e.target.value) || 0 
                })}
                placeholder="300"
                className="w-32"
              />
              <span className="text-sm text-muted-foreground">BYN</span>
            </div>
          </div>

          {/* Access duration */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Длительность доступа
            </Label>
            <RadioGroup
              value={config.accessDuration}
              onValueChange={(v) => onChange({ 
                ...config, 
                accessDuration: v as SaleConfig['accessDuration']
              })}
              className="space-y-1.5"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="forever" id="forever" />
                <Label htmlFor="forever" className="font-normal cursor-pointer">
                  Навсегда
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="days" id="days" />
                <Label htmlFor="days" className="font-normal cursor-pointer flex items-center gap-2">
                  На
                  <Input
                    type="number"
                    min={1}
                    value={config.accessDays || ""}
                    onChange={(e) => onChange({ 
                      ...config, 
                      accessDays: parseInt(e.target.value) || 30,
                      accessDuration: 'days'
                    })}
                    className="w-20 h-7"
                    disabled={config.accessDuration !== 'days'}
                  />
                  дней
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="period" id="period" />
                <Label htmlFor="period" className="font-normal cursor-pointer">
                  До конца текущего периода подписки
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Price rules by tariff */}
          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Tag className="h-3 w-3" />
                Особые цены для тарифов
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addPriceRule}
                className="h-7 text-xs gap-1"
              >
                <Plus className="h-3 w-3" />
                Добавить
              </Button>
            </div>

            {config.priceRules.length > 0 ? (
              <div className="space-y-2">
                {config.priceRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/30 border border-border/30 backdrop-blur-sm"
                  >
                    <Select
                      value={rule.tariffId}
                      onValueChange={(v) => updatePriceRule(rule.id, { tariffId: v })}
                    >
                      <SelectTrigger className="flex-1 h-8 text-xs">
                        <SelectValue placeholder="Выберите тариф" />
                      </SelectTrigger>
                      <SelectContent>
                        {allTariffs.map((t) => (
                          <SelectItem key={t.id} value={t.id} className="text-xs">
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={rule.price || ""}
                      onChange={(e) => updatePriceRule(rule.id, { 
                        price: parseFloat(e.target.value) || 0 
                      })}
                      placeholder="Цена"
                      className="w-24 h-8 text-xs"
                    />
                    <span className="text-xs text-muted-foreground">BYN</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removePriceRule(rule.id)}
                      className="h-8 w-8 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-2">
                Нет особых правил. Все платят базовую цену.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              💡 При совпадении нескольких правил применяется минимальная цена.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
