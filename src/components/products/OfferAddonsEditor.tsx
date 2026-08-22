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
import { CalendarClock, Check, Clock3, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

type PricingMode = "offer_price" | "fixed_price" | "percent_discount" | "free";
type AccessDeliveryMode = "immediate" | "fixed_date" | "manual";

const ACCESS_TIME_ZONE = "Europe/Minsk";
const toIso = (value: string) => value
  ? fromZonedTime(value, ACCESS_TIME_ZONE).toISOString()
  : null;
const toLocalDateTime = (value: string | null | undefined) => {
  if (!value) return "";
  return formatInTimeZone(value, ACCESS_TIME_ZONE, "yyyy-MM-dd'T'HH:mm");
};

const accessModeLabel: Record<AccessDeliveryMode, string> = {
  immediate: "Сразу после оплаты",
  fixed_date: "В назначенную дату",
  manual: "Вручную администратором",
};

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
  const [accessMode, setAccessMode] = useState<AccessDeliveryMode>("immediate");
  const [accessOpensAt, setAccessOpensAt] = useState("");
  const [accessDurationDays, setAccessDurationDays] = useState("");
  const [bulkAccessMode, setBulkAccessMode] = useState<AccessDeliveryMode>("immediate");
  const [bulkAccessOpensAt, setBulkAccessOpensAt] = useState("");

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
      if (accessMode === "fixed_date" && !accessOpensAt) {
        throw new Error("Укажите дату и время открытия модуля");
      }
      const numeric = pricingValue === "" ? null : Number(pricingValue);
      const durationDays = accessDurationDays === "" ? null : Number(accessDurationDays);
      if (durationDays !== null && (!Number.isInteger(durationDays) || durationDays <= 0)) {
        throw new Error("Срок доступа укажите целым числом дней");
      }
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
        access_delivery_mode: accessMode,
        access_opens_at: accessMode === "fixed_date" ? toIso(accessOpensAt) : null,
        access_duration_days: durationDays,
        sort_order: (rules?.length ?? 0) + 1,
      };
      const { error } = await (supabase as any).from("offer_addons").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["offer-addons"] });
      setAddonOfferId(""); setPricingMode("offer_price"); setPricingValue("");
      setRequired(false); setDefaultSelected(false);
      setAccessMode("immediate"); setAccessOpensAt(""); setAccessDurationDays("");
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
  const bulkUpdateAccess = useMutation({
    mutationFn: async () => {
      if (!parentOfferId) throw new Error("Сначала выберите кнопку основного тарифа");
      if (bulkAccessMode === "fixed_date" && !bulkAccessOpensAt) {
        throw new Error("Укажите общую дату и время открытия");
      }
      const { error } = await (supabase as any).from("offer_addons").update({
        access_delivery_mode: bulkAccessMode,
        access_opens_at: bulkAccessMode === "fixed_date" ? toIso(bulkAccessOpensAt) : null,
      }).eq("parent_offer_id", parentOfferId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["offer-addons"] });
      toast.success("Режим открытия применён ко всем модулям этой кнопки");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Дополнительные продукты в корзине</h3>
        <p className="text-sm text-muted-foreground">
          Включите модули для конкретной кнопки тарифа, задайте цену и момент открытия.
          Покупка модуля видна клиенту сразу, даже если сам доступ откроется позднее.
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
        <div className="space-y-2">
          <Label>Когда открыть доступ к модулю</Label>
          <Select value={accessMode} onValueChange={(value) => {
            const next = value as AccessDeliveryMode;
            setAccessMode(next);
            if (next !== "fixed_date") setAccessOpensAt("");
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="immediate">Сразу после оплаты</SelectItem>
              <SelectItem value="fixed_date">В назначенную дату</SelectItem>
              <SelectItem value="manual">Вручную администратором</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {accessMode === "fixed_date" && (
          <div className="space-y-2">
            <Label>Дата и время открытия (Минск)</Label>
            <Input
              type="datetime-local"
              aria-label="Дата и время открытия по Минску"
              value={accessOpensAt}
              onChange={(event) => setAccessOpensAt(event.target.value)}
            />
          </div>
        )}
        <div className="space-y-2">
          <Label>Срок доступа после открытия, дней</Label>
          <Input
            type="number"
            min="1"
            placeholder="По настройкам тарифа"
            value={accessDurationDays}
            onChange={(event) => setAccessDurationDays(event.target.value)}
          />
        </div>
        <div className="flex items-center gap-6 md:col-span-2">
          <label className="flex items-center gap-2 text-sm"><Switch checked={required} onCheckedChange={setRequired} />Обязательный</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={defaultSelected} onCheckedChange={setDefaultSelected} />Выбран по умолчанию</label>
          <Button className="ml-auto" onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus className="h-4 w-4 mr-2" />Добавить
          </Button>
        </div>
      </GlassCard>

      <GlassCard className="p-4 space-y-3 border-primary/20 bg-primary/[0.03]">
        <div className="flex items-start gap-3">
          <CalendarClock className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <h4 className="font-medium">Открытие всех модулей этой кнопки</h4>
            <p className="text-xs text-muted-foreground">
              Массовая настройка перезапишет режим и дату у всех добавленных модулей выбранного тарифа.
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Select value={bulkAccessMode} onValueChange={(value) => {
            const next = value as AccessDeliveryMode;
            setBulkAccessMode(next);
            if (next !== "fixed_date") setBulkAccessOpensAt("");
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="immediate">Сразу после оплаты</SelectItem>
              <SelectItem value="fixed_date">В одну назначенную дату</SelectItem>
              <SelectItem value="manual">Открыть все вручную</SelectItem>
            </SelectContent>
          </Select>
          {bulkAccessMode === "fixed_date" ? (
            <Input
              type="datetime-local"
              aria-label="Общая дата и время открытия по Минску"
              value={bulkAccessOpensAt}
              onChange={(event) => setBulkAccessOpensAt(event.target.value)}
            />
          ) : <div />}
          <Button
            variant="outline"
            onClick={() => bulkUpdateAccess.mutate()}
            disabled={!parentOfferId || bulkUpdateAccess.isPending}
          >
            <Check className="h-4 w-4 mr-2" />Применить ко всем
          </Button>
        </div>
      </GlassCard>

      <div className="space-y-2">
        {(rules ?? []).map((rule: any) => (
          <AddonAccessRuleRow
            key={rule.id}
            rule={rule}
            onSaved={() => qc.invalidateQueries({ queryKey: ["offer-addons"] })}
            onRemove={() => remove.mutate(rule.id)}
          />
        ))}
      </div>
    </div>
  );
}

function AddonAccessRuleRow({
  rule,
  onSaved,
  onRemove,
}: {
  rule: any;
  onSaved: () => void;
  onRemove: () => void;
}) {
  const [mode, setMode] = useState<AccessDeliveryMode>(
    rule.access_delivery_mode ?? "immediate",
  );
  const [opensAt, setOpensAt] = useState(toLocalDateTime(rule.access_opens_at));
  const [durationDays, setDurationDays] = useState(
    rule.access_duration_days == null ? "" : String(rule.access_duration_days),
  );
  const save = useMutation({
    mutationFn: async () => {
      if (mode === "fixed_date" && !opensAt) throw new Error("Укажите дату открытия");
      const normalizedDuration = durationDays === "" ? null : Number(durationDays);
      if (normalizedDuration !== null && (!Number.isInteger(normalizedDuration) || normalizedDuration <= 0)) {
        throw new Error("Срок доступа укажите целым числом дней");
      }
      const { error } = await (supabase as any).from("offer_addons").update({
        access_delivery_mode: mode,
        access_opens_at: mode === "fixed_date" ? toIso(opensAt) : null,
        access_duration_days: normalizedDuration,
      }).eq("id", rule.id);
      if (error) throw error;
    },
    onSuccess: () => {
      onSaved();
      toast.success("Настройка открытия сохранена");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <GlassCard className="p-3 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium">
            {rule.parent_offer?.tariffs?.name} → {rule.addon_product?.name}
          </div>
          <div className="text-xs text-muted-foreground">
            {rule.addon_tariff?.name} · {rule.addon_offer?.button_label}
          </div>
        </div>
        <Badge variant="outline">
          {rule.pricing_mode === "free"
            ? "Бесплатно"
            : rule.pricing_mode === "percent_discount"
              ? `−${rule.discount_percent}%`
              : rule.pricing_mode === "fixed_price"
                ? `${rule.fixed_amount}`
                : `${rule.addon_offer?.amount}`}
        </Badge>
        {rule.is_required && <Badge>Обязательный</Badge>}
        <Button variant="ghost" size="icon" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid gap-2 md:grid-cols-[1fr_1fr_180px_auto]">
        <Select value={mode} onValueChange={(value) => {
          const next = value as AccessDeliveryMode;
          setMode(next);
          if (next !== "fixed_date") setOpensAt("");
        }}>
          <SelectTrigger className="h-9">
            <Clock3 className="h-4 w-4 mr-2 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(accessModeLabel).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {mode === "fixed_date" ? (
          <Input
            className="h-9"
            type="datetime-local"
            aria-label="Дата и время открытия по Минску"
            value={opensAt}
            onChange={(event) => setOpensAt(event.target.value)}
          />
        ) : <div />}
        <Input
          className="h-9"
          type="number"
          min="1"
          placeholder="Срок, дней"
          value={durationDays}
          onChange={(event) => setDurationDays(event.target.value)}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          <Save className="h-4 w-4 mr-2" />Сохранить
        </Button>
      </div>
    </GlassCard>
  );
}
