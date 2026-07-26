/* eslint-disable @typescript-eslint/no-explicit-any -- remove after Lovable regenerates Supabase product referral types */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUpdateProductV2 } from "@/hooks/useProductsV2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Mode = "inherit" | "custom" | "disabled";
type Scheme = "flat" | "tiered" | "club_first_payment";

export function ProductReferralSettings({ product }: { product: any }) {
  const updateProduct = useUpdateProductV2();
  const [mode, setMode] = useState<Mode>(product.referral_settings_mode ?? "inherit");
  const [commission, setCommission] = useState(String(Number(product.referral_commission_percent_bps ?? 1000) / 100));
  const [discount, setDiscount] = useState(String(Number(product.referral_customer_discount_percent_bps ?? 0) / 100));
  const [scheme, setScheme] = useState<Scheme>(product.referral_commission_scheme ?? "flat");
  const [bonusEligible, setBonusEligible] = useState(product.referral_bonus_eligible !== false);
  const [tier1Limit, setTier1Limit] = useState(String(product.referral_tier_1_limit ?? 10));
  const [tier2Limit, setTier2Limit] = useState(String(product.referral_tier_2_limit ?? 20));
  const [tier1Commission, setTier1Commission] = useState(String(Number(product.referral_tier_1_commission_percent_bps ?? 1000) / 100));
  const [tier2Commission, setTier2Commission] = useState(String(Number(product.referral_tier_2_commission_percent_bps ?? 2000) / 100));
  const [tier3Commission, setTier3Commission] = useState(String(Number(product.referral_tier_3_commission_percent_bps ?? 3000) / 100));
  const { data: defaults } = useQuery({
    queryKey: ["referral-program-default-percentages"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("referral_program_settings")
        .select("commission_percent_bps,customer_discount_percent_bps").eq("singleton", true).single();
      if (error) throw error;
      return data as { commission_percent_bps: number; customer_discount_percent_bps: number };
    },
  });

  useEffect(() => {
    setMode(product.referral_settings_mode ?? "inherit");
    setCommission(String(Number(product.referral_commission_percent_bps ?? defaults?.commission_percent_bps ?? 1000) / 100));
    setDiscount(String(Number(product.referral_customer_discount_percent_bps ?? defaults?.customer_discount_percent_bps ?? 0) / 100));
    setScheme(product.referral_commission_scheme ?? "flat");
    setBonusEligible(product.referral_bonus_eligible !== false);
    setTier1Limit(String(product.referral_tier_1_limit ?? 10));
    setTier2Limit(String(product.referral_tier_2_limit ?? 20));
    setTier1Commission(String(Number(product.referral_tier_1_commission_percent_bps ?? 1000) / 100));
    setTier2Commission(String(Number(product.referral_tier_2_commission_percent_bps ?? 2000) / 100));
    setTier3Commission(String(Number(product.referral_tier_3_commission_percent_bps ?? 3000) / 100));
  }, [product, defaults]);

  const toBps = (value: string) => Math.round(Number(value.replace(",", ".")) * 100);
  const save = async () => {
    const commissionBps = toBps(commission);
    const discountBps = toBps(discount);
    if (![commissionBps, discountBps].every((value) => Number.isInteger(value) && value >= 0 && value <= 10000)) return;
    await updateProduct.mutateAsync({
      id: product.id,
      referral_settings_mode: mode,
      referral_commission_percent_bps: mode === "custom" ? commissionBps : null,
      referral_customer_discount_percent_bps: mode === "custom" ? discountBps : null,
      referral_commission_scheme: mode === "disabled" ? null : scheme,
      referral_bonus_eligible: bonusEligible,
      referral_tier_1_limit: Math.max(1, Math.round(Number(tier1Limit))),
      referral_tier_2_limit: Math.max(1, Math.round(Number(tier2Limit))),
      referral_tier_1_commission_percent_bps: toBps(tier1Commission),
      referral_tier_2_commission_percent_bps: toBps(tier2Commission),
      referral_tier_3_commission_percent_bps: toBps(tier3Commission),
    } as any);
  };

  return (
    <Card>
      <CardHeader><CardTitle>Реферальная программа продукта</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>Правило продукта</Label>
          <Select value={mode} onValueChange={(value) => setMode(value as Mode)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Общие настройки программы</SelectItem>
              <SelectItem value="custom">Индивидуальные проценты</SelectItem>
              <SelectItem value="disabled">Не участвует в программе</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {mode === "inherit" && (
          <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            Партнёру: {Number(defaults?.commission_percent_bps ?? 0) / 100}%. Скидка приглашённому: {Number(defaults?.customer_discount_percent_bps ?? 0) / 100}%.
          </p>
        )}
        {mode === "custom" && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Вознаграждение партнёру, %</Label><Input type="number" min="0" max="100" step="0.01" value={commission} onChange={(e) => setCommission(e.target.value)} /></div>
            <div className="space-y-2"><Label>Скидка приглашённому, %</Label><Input type="number" min="0" max="100" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
          </div>
        )}
        {mode !== "disabled" && <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label>Схема комиссии</Label><Select value={scheme} onValueChange={(value) => setScheme(value as Scheme)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="flat">Общий процент</SelectItem><SelectItem value="tiered">Ступени 10 / 20 / далее</SelectItem><SelectItem value="club_first_payment">Club: только первый платёж</SelectItem></SelectContent></Select></div>
          <label className="flex items-center justify-between rounded-md border px-3"><span className="text-sm font-medium">Разрешить оплату баллами</span><input type="checkbox" checked={bonusEligible} onChange={(event) => setBonusEligible(event.target.checked)} /></label>
        </div>}
        {mode !== "disabled" && scheme === "tiered" && <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2"><Label>Первые, чел.</Label><Input type="number" min="1" value={tier1Limit} onChange={(e) => setTier1Limit(e.target.value)} /></div>
          <div className="space-y-2"><Label>Следующие, чел.</Label><Input type="number" min="1" value={tier2Limit} onChange={(e) => setTier2Limit(e.target.value)} /></div>
          <div className="space-y-2"><Label>Проценты 1 / 2 / 3</Label><div className="flex gap-1"><Input type="number" min="0" max="100" step="0.01" value={tier1Commission} onChange={(e) => setTier1Commission(e.target.value)} /><Input type="number" min="0" max="100" step="0.01" value={tier2Commission} onChange={(e) => setTier2Commission(e.target.value)} /><Input type="number" min="0" max="100" step="0.01" value={tier3Commission} onChange={(e) => setTier3Commission(e.target.value)} /></div></div>
        </div>}
        <p className="text-xs text-muted-foreground">Проценты фиксируются в снимке продажи. Последующее изменение настройки не меняет уже начисленные суммы.</p>
        <Button onClick={save} disabled={updateProduct.isPending}>Сохранить настройки продукта</Button>
      </CardContent>
    </Card>
  );
}
