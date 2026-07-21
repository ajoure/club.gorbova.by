/* eslint-disable @typescript-eslint/no-explicit-any -- removed after Lovable regenerates Supabase types */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { formatBynMinor, referralStatusLabel } from "@/lib/referrals";
import { usePermissions } from "@/hooks/usePermissions";

export default function AdminReferrals() {
  const qc = useQueryClient();
  const { isSuperAdmin } = usePermissions();
  const canConfigure = isSuperAdmin();
  const query = useQuery({
    queryKey: ["admin-referrals-overview"],
    queryFn: async () => {
      const client = supabase as any;
      const [settings, products, partners, relationships, sales, entries, payouts] = await Promise.all([
        client.from("referral_program_settings").select("*").eq("singleton", true).single(),
        client.from("products_v2").select("id,name,referral_settings_mode,referral_commission_percent_bps,referral_customer_discount_percent_bps").order("name"),
        client.from("referral_partners").select("id,public_id,partner_code,status,joined_at,profiles:profile_id(full_name,email)").order("joined_at", { ascending: false }),
        client.from("referral_relationships").select("id,public_id,partner_id,attached_at,status,referred:referred_profile_id(full_name,email)").order("attached_at", { ascending: false }).limit(100),
        client.from("referral_sale_attributions").select("id,public_id,partner_id,status,commission_percent_bps,commission_minor,reversed_minor,created_at,product:product_id(name)").order("created_at", { ascending: false }).limit(100),
        client.from("referral_balance_entries").select("partner_id,bucket,amount_minor"),
        client.from("referral_payout_requests").select("id,public_id,partner_id,amount_minor,status,requested_at,payment_reference").order("requested_at", { ascending: false }).limit(50),
      ]);
      for (const result of [settings, products, partners, relationships, sales, entries, payouts]) if (result.error) throw result.error;
      return { settings: settings.data, products: products.data ?? [], partners: partners.data ?? [], relationships: relationships.data ?? [], sales: sales.data ?? [], entries: entries.data ?? [], payouts: payouts.data ?? [] };
    },
  });

  const updateSettings = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const { error } = await (supabase as any).from("referral_program_settings").update({ ...updates, updated_at: new Date().toISOString() }).eq("singleton", true);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Настройки сохранены"); qc.invalidateQueries({ queryKey: ["admin-referrals-overview"] }); },
    onError: (error: Error) => toast.error(error.message),
  });

  const decidePayout = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "paid" | "rejected" }) => {
      const paymentReference = decision === "paid" ? window.prompt("Укажите номер или комментарий к выплате") : null;
      if (decision === "paid" && !paymentReference) throw new Error("Для погашения нужен номер или комментарий к выплате");
      const reason = decision === "rejected" ? window.prompt("Укажите причину отклонения") : null;
      const { error } = await (supabase.rpc as any)("referral_admin_decide_payout", { p_request_id: id, p_decision: decision, p_reason: reason, p_payment_reference: paymentReference });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Заявка обработана"); qc.invalidateQueries({ queryKey: ["admin-referrals-overview"] }); },
    onError: (error: Error) => toast.error(error.message),
  });

  if (query.isLoading) return <div className="min-h-[50vh] grid place-items-center"><Loader2 className="animate-spin" /></div>;
  if (query.error) return <div className="p-6 text-destructive">Реферальная схема ещё не опубликована в Lovable Cloud либо недоступна.</div>;
  const data = query.data!;
  const totals = data.entries.reduce((acc: Record<string, number>, row: any) => { acc[row.bucket] = (acc[row.bucket] ?? 0) + Number(row.amount_minor); return acc; }, {});

  return <div className="p-4 sm:p-6 space-y-6">
    <div><h1 className="text-2xl font-bold flex items-center gap-2"><Gift className="h-6 w-6" /> Реферальная программа</h1><p className="text-muted-foreground mt-1">Общие правила, партнёры, приглашённые, начисления и выплаты.</p></div>
    <Card><CardHeader><CardTitle>Запуск программы</CardTitle></CardHeader><CardContent className="grid sm:grid-cols-2 gap-4">
      <Setting label="Программа включена" checked={data.settings.is_enabled} disabled={!canConfigure} onChange={(value) => updateSettings.mutate({ is_enabled: value })} />
      <Setting label="Ссылки и привязка" checked={data.settings.tracking_enabled} disabled={!canConfigure} onChange={(value) => updateSettings.mutate({ tracking_enabled: value })} />
      <Setting label="Кабинет партнёра" checked={data.settings.partner_portal_enabled} disabled={!canConfigure} onChange={(value) => updateSettings.mutate({ partner_portal_enabled: value })} />
      <Setting label="Реальные начисления" checked={data.settings.accrual_enabled && !data.settings.shadow_mode} disabled={!canConfigure} onChange={(value) => updateSettings.mutate({ accrual_enabled: value, shadow_mode: !value })} />
      <Setting label="Заявки на выплату" checked={data.settings.payout_requests_enabled} disabled={!canConfigure} onChange={(value) => updateSettings.mutate({ payout_requests_enabled: value })} />
      <Setting label="Разделение 60/40" checked={data.settings.split_60_40_enabled} disabled={!canConfigure} onChange={(value) => updateSettings.mutate({ split_60_40_enabled: value, withdrawable_percent_bps: 6000 })} />
      <PercentageSetting label="Вознаграждение партнёру по умолчанию" valueBps={data.settings.commission_percent_bps} disabled={!canConfigure} onSave={(value) => updateSettings.mutate({ commission_percent_bps: value })} />
      <PercentageSetting label="Скидка приглашённому по умолчанию" valueBps={data.settings.customer_discount_percent_bps} disabled={!canConfigure} onSave={(value) => updateSettings.mutate({ customer_discount_percent_bps: value })} />
      {!canConfigure && <p className="sm:col-span-2 text-xs text-muted-foreground">Общие настройки может изменять только суперадминистратор.</p>}
      <p className="sm:col-span-2 text-xs text-muted-foreground">При включении 60% новых начислений доступны к выводу после периода ожидания, 40% учитываются как внутренний бонус. Старые начисления не пересчитываются.</p>
      <p className="sm:col-span-2 text-xs text-muted-foreground">Включайте реальные начисления только после shadow-проверки в Lovable Cloud. Миграция первоначально оставляет все переключатели выключенными.</p>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Правила по продуктам</CardTitle></CardHeader><CardContent className="space-y-2">
      {data.products.map((product: any) => { const custom = product.referral_settings_mode === "custom"; const disabled = product.referral_settings_mode === "disabled"; return <div key={product.id} className="border rounded-md p-3 flex items-center justify-between gap-3 text-sm"><div><p className="font-medium">{product.name}</p><p className="text-xs text-muted-foreground">{disabled ? "Не участвует" : custom ? "Индивидуальные настройки" : "Общие настройки"}</p></div><div className="text-right text-xs">{!disabled && <><p>Партнёру: {Number(custom ? product.referral_commission_percent_bps : data.settings.commission_percent_bps) / 100}%</p><p>Скидка: {Number(custom ? product.referral_customer_discount_percent_bps : data.settings.customer_discount_percent_bps) / 100}%</p></>}</div></div>; })}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Кто кого пригласил</CardTitle></CardHeader><CardContent className="space-y-2">
      {data.relationships.map((r: any) => { const partner = data.partners.find((p: any) => p.id === r.partner_id); return <div key={r.id} className="border rounded-md p-3 text-sm"><p className="font-medium">{partner?.profiles?.full_name || partner?.partner_code || "Партнёр"} → {r.referred?.full_name || r.referred?.email || "Пользователь"}</p><p className="text-xs text-muted-foreground">{new Date(r.attached_at).toLocaleDateString("ru-BY")} · {r.public_id}</p></div>; })}
      {!data.relationships.length && <p className="text-sm text-muted-foreground">Приглашений пока нет.</p>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Начисления по покупкам</CardTitle></CardHeader><CardContent className="space-y-2">
      {data.sales.map((sale: any) => <div key={sale.id} className="border rounded-md p-3 flex items-center justify-between gap-3 text-sm"><div><p className="font-medium">{sale.product?.name || "Продукт"}</p><p className="text-xs text-muted-foreground">{Number(sale.commission_percent_bps) / 100}% · {new Date(sale.created_at).toLocaleDateString("ru-BY")}</p></div><div className="text-right"><p className="font-medium">{formatBynMinor(Number(sale.commission_minor) - Number(sale.reversed_minor))}</p><Badge variant="secondary">{referralStatusLabel(sale.status)}</Badge></div></div>)}
      {!data.sales.length && <p className="text-sm text-muted-foreground">Начислений пока нет.</p>}
    </CardContent></Card>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><Summary label="Партнёры" value={String(data.partners.length)} /><Summary label="Начислено" value={formatBynMinor(totals.pending)} /><Summary label="К выплате" value={formatBynMinor(totals.available)} /><Summary label="Выплачено" value={formatBynMinor(totals.paid)} /></div>
    <Card><CardHeader><CardTitle>Партнёры</CardTitle></CardHeader><CardContent className="space-y-2">
      {data.partners.map((p: any) => <div key={p.id} className="border rounded-md p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><p className="font-medium">{p.profiles?.full_name || "Без имени"}</p><p className="text-xs text-muted-foreground">{p.profiles?.email || "Email не указан"} · {p.partner_code}</p></div><Badge variant="secondary">{referralStatusLabel(p.status)}</Badge></div>)}
      {!data.partners.length && <p className="text-sm text-muted-foreground">Партнёров пока нет.</p>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Заявки на выплату</CardTitle></CardHeader><CardContent className="space-y-2">
      {data.payouts.map((p: any) => <div key={p.id} className="border rounded-md p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><p className="font-medium">{p.public_id}</p><p className="text-xs text-muted-foreground">{new Date(p.requested_at).toLocaleDateString("ru-BY")}</p></div><div className="flex items-center gap-2 sm:justify-end"><div className="text-right mr-2"><p className="font-medium">{formatBynMinor(p.amount_minor)}</p><Badge variant="secondary">{p.status}</Badge></div>{p.status === "pending" && <><Button size="sm" variant="outline" onClick={() => decidePayout.mutate({ id: p.id, decision: "rejected" })}>Отклонить</Button><Button size="sm" onClick={() => decidePayout.mutate({ id: p.id, decision: "paid" })}>Погасить</Button></>}</div></div>)}
      {!data.payouts.length && <p className="text-sm text-muted-foreground">Заявок пока нет.</p>}
    </CardContent></Card>
  </div>;
}

function Setting({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange(value: boolean): void }) {
  return <label className="flex items-center justify-between gap-4 rounded-md border p-3 text-sm"><span>{label}</span><Switch checked={checked} disabled={disabled} onCheckedChange={onChange} /></label>;
}

function PercentageSetting({ label, valueBps, disabled, onSave }: { label: string; valueBps: number; disabled?: boolean; onSave(valueBps: number): void }) {
  return <div className="rounded-md border p-3 space-y-2"><Label>{label}</Label><div className="flex items-center gap-2"><Input key={valueBps} type="number" min="0" max="100" step="0.01" disabled={disabled} defaultValue={Number(valueBps ?? 0) / 100} onBlur={(event) => { const value = Math.round(Number(event.target.value.replace(",", ".")) * 100); if (Number.isInteger(value) && value >= 0 && value <= 10000 && value !== valueBps) onSave(value); }} /><span className="text-sm">%</span></div></div>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold mt-1">{value}</p></CardContent></Card>;
}
