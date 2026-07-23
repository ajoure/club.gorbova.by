import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProductsV2, useTariffs } from "@/hooks/useProductsV2";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type PricingMode = "offer_price" | "fixed_price" | "percent_discount" | "free";

export function OfferAddonsEditor({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const { data: products } = useProductsV2();
  const { data: parentTariffs } = useTariffs(productId);
  const [parentOfferId, setParentOfferId] = useState("");
  const [addonProductId, setAddonProductId] = useState("");
  const { data: addonTariffs } = useTariffs(addonProductId);
  const [addonTariffId, setAddonTariffId] = useState("");
  const [addonOfferId, setAddonOfferId] = useState("");
  const [pricingMode, setPricingMode] = useState<PricingMode>("offer_price");
  const [pricingValue, setPricingValue] = useState("");
  const [required, setRequired] = useState(false);
  const [defaultSelected, setDefaultSelected] = useState(false);

  const parentTariffIds = useMemo(() => (parentTariffs ?? []).map((t) => t.id), [parentTariffs]);
  const { data: parentOffers } = useQuery({
    queryKey: ["composition-parent-offers", parentTariffIds],
    enabled: parentTariffIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("tariff_offers")
        .select("id,button_label,amount,tariff_id,tariffs(name)")
        .in("tariff_id", parentTariffIds).eq("is_active", true).order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: addonOffers } = useQuery({
    queryKey: ["composition-addon-offers", addonTariffId],
    enabled: !!addonTariffId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("tariff_offers")
        .select("id,button_label,amount").eq("tariff_id", addonTariffId)
        .eq("is_active", true).order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: rules } = useQuery({
    queryKey: ["offer-addons", productId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("offer_addons").select(
        "*,parent_offer:tariff_offers!offer_addons_parent_offer_id_fkey(button_label,tariffs(name)),addon_product:products_v2!offer_addons_addon_product_id_fkey(name),addon_tariff:tariffs!offer_addons_addon_tariff_id_fkey(name),addon_offer:tariff_offers!offer_addons_addon_offer_id_fkey(button_label,amount)"
      ).in("parent_offer_id", (parentOffers ?? []).map((offer: any) => offer.id)).order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!parentOffers?.length,
  });

  useEffect(() => { setAddonTariffId(""); setAddonOfferId(""); }, [addonProductId]);
  useEffect(() => { setAddonOfferId(""); }, [addonTariffId]);

  const create = useMutation({
    mutationFn: async () => {
      if (!parentOfferId || !addonProductId || !addonTariffId || !addonOfferId) {
        throw new Error("Выберите основную кнопку, продукт, тариф и кнопку модуля");
      }
      const numeric = pricingValue === "" ? null : Number(pricingValue);
      const payload: any = {
        parent_offer_id: parentOfferId,
        addon_product_id: addonProductId,
        addon_tariff_id: addonTariffId,
        addon_offer_id: addonOfferId,
        pricing_mode: pricingMode,
        fixed_amount: pricingMode === "fixed_price" ? numeric : null,
        discount_percent: pricingMode === "percent_discount" ? numeric : null,
        is_required: required,
        is_default_selected: required || defaultSelected,
        allow_repurchase_after_expiry: true,
        sort_order: (rules?.length ?? 0) + 1,
      };
      const { error } = await (supabase as any).from("offer_addons").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["offer-addons"] });
      setAddonOfferId(""); setPricingMode("offer_price"); setPricingValue("");
      setRequired(false); setDefaultSelected(false);
      toast.success("Дополнительный продукт добавлен к кнопке");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("offer_addons").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["offer-addons"] }),
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Дополнительные продукты в корзине</h3>
        <p className="text-sm text-muted-foreground">
          Настройка действует для конкретной кнопки тарифа. Модуль остаётся самостоятельным продуктом.
        </p>
      </div>
      <GlassCard className="p-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label>Кнопка основного тарифа</Label>
          <Select value={parentOfferId} onValueChange={setParentOfferId}>
            <SelectTrigger><SelectValue placeholder="Выберите кнопку" /></SelectTrigger>
            <SelectContent>{(parentOffers ?? []).map((o: any) =>
              <SelectItem key={o.id} value={o.id}>{o.tariffs?.name} — {o.button_label} ({o.amount})</SelectItem>
            )}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Дополнительный продукт</Label>
          <Select value={addonProductId} onValueChange={setAddonProductId}>
            <SelectTrigger><SelectValue placeholder="Продукт" /></SelectTrigger>
            <SelectContent>{(products ?? []).filter((p) => p.id !== productId && p.is_active).map((p) =>
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            )}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Тариф модуля</Label>
          <Select value={addonTariffId} onValueChange={setAddonTariffId}>
            <SelectTrigger><SelectValue placeholder="Тариф" /></SelectTrigger>
            <SelectContent>{(addonTariffs ?? []).filter((t) => t.is_active).map((t) =>
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            )}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Кнопка и базовая цена модуля</Label>
          <Select value={addonOfferId} onValueChange={setAddonOfferId}>
            <SelectTrigger><SelectValue placeholder="Кнопка" /></SelectTrigger>
            <SelectContent>{(addonOffers ?? []).map((o: any) =>
              <SelectItem key={o.id} value={o.id}>{o.button_label} — {o.amount}</SelectItem>
            )}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Цена в комплекте</Label>
          <div className="flex gap-2">
            <Select value={pricingMode} onValueChange={(v) => setPricingMode(v as PricingMode)}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="offer_price">Цена кнопки</SelectItem>
                <SelectItem value="fixed_price">Фиксированная цена</SelectItem>
                <SelectItem value="percent_discount">Скидка, %</SelectItem>
                <SelectItem value="free">Бесплатно</SelectItem>
              </SelectContent>
            </Select>
            {(pricingMode === "fixed_price" || pricingMode === "percent_discount") &&
              <Input type="number" min="0" max={pricingMode === "percent_discount" ? 100 : undefined}
                value={pricingValue} onChange={(e) => setPricingValue(e.target.value)} />}
          </div>
        </div>
        <div className="flex items-center gap-6 md:col-span-2">
          <label className="flex items-center gap-2 text-sm"><Switch checked={required} onCheckedChange={setRequired} />Обязательный</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={defaultSelected} onCheckedChange={setDefaultSelected} />Выбран по умолчанию</label>
          <Button className="ml-auto" onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus className="h-4 w-4 mr-2" />Добавить
          </Button>
        </div>
      </GlassCard>
      <div className="space-y-2">
        {(rules ?? []).map((rule: any) => (
          <GlassCard key={rule.id} className="p-3 flex items-center gap-3">
            <div className="flex-1">
              <div className="font-medium">{rule.parent_offer?.tariffs?.name} → {rule.addon_product?.name}</div>
              <div className="text-xs text-muted-foreground">{rule.addon_tariff?.name} · {rule.addon_offer?.button_label}</div>
            </div>
            <Badge variant="outline">{rule.pricing_mode === "free" ? "Бесплатно" : rule.pricing_mode === "percent_discount" ? `−${rule.discount_percent}%` : rule.pricing_mode === "fixed_price" ? `${rule.fixed_amount}` : `${rule.addon_offer?.amount}`}</Badge>
            {rule.is_required && <Badge>Обязательный</Badge>}
            <Button variant="ghost" size="icon" onClick={() => remove.mutate(rule.id)}><Trash2 className="h-4 w-4" /></Button>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
