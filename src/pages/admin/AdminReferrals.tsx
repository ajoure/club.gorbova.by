/* eslint-disable @typescript-eslint/no-explicit-any -- removed after Lovable regenerates Supabase types */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Gift, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { formatBynMinor, referralStatusLabel } from "@/lib/referrals";
import { usePermissions } from "@/hooks/usePermissions";

const PARTNERS_PAGE_SIZE = 50;

export default function AdminReferrals() {
  const qc = useQueryClient();
  const { isSuperAdmin } = usePermissions();
  const canConfigure = isSuperAdmin();
  const [partnersPage, setPartnersPage] = useState(0);

  const query = useQuery({
    queryKey: ["admin-referrals-overview"],
    queryFn: async () => {
      const client = supabase as any;
      const [settings, products, relationships, sales, payouts, summary] = await Promise.all([
        client.from("referral_program_settings").select("*").eq("singleton", true).single(),
        client.from("products_v2").select("id,name,referral_settings_mode,referral_commission_percent_bps,referral_customer_discount_percent_bps").order("name"),
        client.from("referral_relationships").select("id,public_id,partner_id,attached_at,status,referred:referred_profile_id(full_name,email),partner:partner_id(partner_code,profiles:profile_id(full_name,email))").order("attached_at", { ascending: false }).limit(100),
        client.from("referral_sale_attributions").select("id,public_id,partner_id,status,commission_percent_bps,commission_minor,reversed_minor,created_at,product:product_id(name)").order("created_at", { ascending: false }).limit(100),
        client.from("referral_payout_requests").select("id,public_id,partner_id,amount_minor,status,requested_at,payment_reference").order("requested_at", { ascending: false }).limit(100),
        client.rpc("referral_admin_get_summary"),
      ]);
      for (const result of [settings, products, relationships, sales, payouts, summary]) if (result.error) throw result.error;
      return { settings: settings.data, products: products.data ?? [], relationships: relationships.data ?? [], sales: sales.data ?? [], payouts: payouts.data ?? [], summary: summary.data ?? {} };
    },
  });

  const partnersQuery = useQuery({
    queryKey: ["admin-referrals-partners", partnersPage],
    queryFn: async () => {
      const from = partnersPage * PARTNERS_PAGE_SIZE;
      const { data, count, error } = await (supabase as any)
        .from("referral_partners")
        .select("id,public_id,partner_code,status,joined_at,profiles:profile_id(full_name,email)", { count: "exact" })
        .order("joined_at", { ascending: false })
        .range(from, from + PARTNERS_PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
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

  const partnersCount = partnersQuery.data?.count ?? Number(query.data?.summary?.partners_count ?? 0);
  const partnersPages = Math.max(1, Math.ceil(partnersCount / PARTNERS_PAGE_SIZE));
  useEffect(() => {
    if (partnersPage >= partnersPages) setPartnersPage(partnersPages - 1);
  }, [partnersPage, partnersPages]);

  if (query.isLoading) return <div className="min-h-[50vh] grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (query.error) return <div className="p-6 text-sm text-destructive">Реферальная схема недоступна.</div>;
  const data = query.data!;
  const summary = data.summary as Record<string, number>;

  return <div className="mx-auto w-full max-w-[1500px] space-y-4 p-4 sm:p-6">
    <header className="space-y-1">
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><Gift className="h-5 w-5" /> Реферальная программа</h1>
      <p className="text-sm text-muted-foreground">Управление правилами, партнёрами, начислениями и выплатами.</p>
    </header>

    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Summary label="Партнёры" value={partnersCount.toLocaleString("ru-BY")} />
      <Summary label="Начислено" value={formatBynMinor(Number(summary.pending_minor ?? 0))} />
      <Summary label="К выплате" value={formatBynMinor(Number(summary.available_minor ?? 0))} />
      <Summary label="Выплачено" value={formatBynMinor(Number(summary.paid_minor ?? 0))} />
    </div>

    <Tabs defaultValue="overview" className="space-y-4">
      <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-muted/60 p-1">
        <TabsTrigger value="overview" className="text-xs font-medium sm:text-sm">Обзор</TabsTrigger>
        <TabsTrigger value="partners" className="text-xs font-medium sm:text-sm">Партнёры <span className="ml-1 text-muted-foreground">{partnersCount.toLocaleString("ru-BY")}</span></TabsTrigger>
        <TabsTrigger value="payouts" className="text-xs font-medium sm:text-sm">Выплаты</TabsTrigger>
        <TabsTrigger value="products" className="text-xs font-medium sm:text-sm">Продукты</TabsTrigger>
        <TabsTrigger value="settings" className="text-xs font-medium sm:text-sm">Настройки</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4">
        <Section title="Кто кого пригласил" subtitle={`Активных связей: ${Number(summary.relationships_count ?? 0).toLocaleString("ru-BY")}`}>
          <div className="divide-y">
            {data.relationships.map((r: any) => <CompactRow key={r.id} title={`${r.partner?.profiles?.full_name || r.partner?.profiles?.email || r.partner?.partner_code || "Партнёр"} → ${r.referred?.full_name || r.referred?.email || "Пользователь"}`} meta={`${new Date(r.attached_at).toLocaleDateString("ru-BY")} · ${r.public_id}`} />)}
            {!data.relationships.length && <Empty>Приглашений пока нет.</Empty>}
          </div>
        </Section>
        <Section title="Начисления по покупкам" subtitle={`Всего начислений: ${Number(summary.sales_count ?? 0).toLocaleString("ru-BY")}`}>
          <div className="divide-y">
            {data.sales.map((sale: any) => <CompactRow key={sale.id} title={sale.product?.name || "Продукт"} meta={`${Number(sale.commission_percent_bps) / 100}% · ${new Date(sale.created_at).toLocaleDateString("ru-BY")}`} aside={<><span className="font-medium">{formatBynMinor(Number(sale.commission_minor) - Number(sale.reversed_minor))}</span><Badge variant="secondary" className="text-[11px] font-medium">{referralStatusLabel(sale.status)}</Badge></>} />)}
            {!data.sales.length && <Empty>Начислений пока нет.</Empty>}
          </div>
        </Section>
      </TabsContent>

      <TabsContent value="partners">
        <Section title="Все партнёры" subtitle={`Показаны все ${partnersCount.toLocaleString("ru-BY")} записей постранично, без ограничения в 1000`}>
          {partnersQuery.isLoading ? <div className="grid min-h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : <div className="divide-y">
            {partnersQuery.data?.rows.map((p: any) => <CompactRow key={p.id} title={p.profiles?.full_name || "Без имени"} meta={`${p.profiles?.email || "Email не указан"} · ${p.partner_code}`} aside={<Badge variant="secondary" className="text-[11px] font-medium">{referralStatusLabel(p.status)}</Badge>} />)}
          </div>}
          <div className="flex flex-col gap-2 border-t px-3 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Страница {partnersPage + 1} из {partnersPages} · {partnersCount.toLocaleString("ru-BY")} партнёров</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="h-8 px-2 text-xs font-medium" disabled={partnersPage === 0 || partnersQuery.isFetching} onClick={() => setPartnersPage((page) => Math.max(0, page - 1))}><ChevronLeft className="mr-1 h-3.5 w-3.5" /> Назад</Button>
              <Button size="sm" variant="outline" className="h-8 px-2 text-xs font-medium" disabled={partnersPage + 1 >= partnersPages || partnersQuery.isFetching} onClick={() => setPartnersPage((page) => page + 1)}>Далее <ChevronRight className="ml-1 h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </Section>
      </TabsContent>

      <TabsContent value="payouts">
        <Section title="Заявки на выплату" subtitle="Последние 100 заявок">
          <div className="divide-y">
            {data.payouts.map((p: any) => <CompactRow key={p.id} title={p.public_id} meta={new Date(p.requested_at).toLocaleDateString("ru-BY")} aside={<div className="flex items-center gap-2"><span className="font-medium">{formatBynMinor(p.amount_minor)}</span><Badge variant="secondary" className="text-[11px] font-medium">{p.status}</Badge>{p.status === "pending" && <><Button size="sm" variant="outline" className="h-7 px-2 text-xs font-medium" onClick={() => decidePayout.mutate({ id: p.id, decision: "rejected" })}>Отклонить</Button><Button size="sm" className="h-7 px-2 text-xs font-medium" onClick={() => decidePayout.mutate({ id: p.id, decision: "paid" })}>Погасить</Button></>}</div>} />)}
            {!data.payouts.length && <Empty>Заявок пока нет.</Empty>}
          </div>
        </Section>
      </TabsContent>

      <TabsContent value="products">
        <Section title="Правила по продуктам" subtitle="Индивидуальные значения имеют приоритет над общими">
          <div className="divide-y">
            {data.products.map((product: any) => { const custom = product.referral_settings_mode === "custom"; const disabled = product.referral_settings_mode === "disabled"; return <CompactRow key={product.id} title={product.name} meta={disabled ? "Не участвует" : custom ? "Индивидуальные настройки" : "Общие настройки"} aside={!disabled ? <span className="text-xs text-muted-foreground">Партнёру {Number(custom ? product.referral_commission_percent_bps : data.settings.commission_percent_bps) / 100}% · скидка {Number(custom ? product.referral_customer_discount_percent_bps : data.settings.customer_discount_percent_bps) / 100}%</span> : undefined} />; })}
          </div>
        </Section>
      </TabsContent>

      <TabsContent value="settings">
        <Section title="Настройки программы" subtitle="Общие настройки изменяет только суперадминистратор">
          <div className="grid gap-2 p-3 sm:grid-cols-2">
            <Setting label="Программа включена" checked={data.settings.is_enabled} disabled={!canConfigure} onChange={(value) => updateSettings.mutate({ is_enabled: value })} />
            <Setting label="Ссылки и привязка" checked={data.settings.tracking_enabled} disabled={!canConfigure} onChange={(value) => updateSettings.mutate({ tracking_enabled: value })} />
            <Setting label="Кабинет партнёра" checked={data.settings.partner_portal_enabled} disabled={!canConfigure} onChange={(value) => updateSettings.mutate({ partner_portal_enabled: value })} />
            <Setting label="Реальные начисления" checked={data.settings.accrual_enabled && !data.settings.shadow_mode} disabled={!canConfigure} onChange={(value) => updateSettings.mutate({ accrual_enabled: value, shadow_mode: !value })} />
            <Setting label="Заявки на выплату" checked={data.settings.payout_requests_enabled} disabled={!canConfigure} onChange={(value) => updateSettings.mutate({ payout_requests_enabled: value })} />
            <Setting label="Разделение 60/40" checked={data.settings.split_60_40_enabled} disabled={!canConfigure} onChange={(value) => updateSettings.mutate({ split_60_40_enabled: value, withdrawable_percent_bps: 6000 })} />
            <PercentageSetting label="Вознаграждение партнёру" valueBps={data.settings.commission_percent_bps} disabled={!canConfigure} onSave={(value) => updateSettings.mutate({ commission_percent_bps: value })} />
            <PercentageSetting label="Скидка приглашённому" valueBps={data.settings.customer_discount_percent_bps} disabled={!canConfigure} onSave={(value) => updateSettings.mutate({ customer_discount_percent_bps: value })} />
            <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-2">При включении правила 60/40 только новые начисления делятся: 60% доступны к выводу после периода ожидания, 40% учитываются как внутренний бонус. Старые начисления не пересчитываются.</p>
          </div>
        </Section>
      </TabsContent>
    </Tabs>
  </div>;
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return <Card className="overflow-hidden shadow-sm"><CardHeader className="space-y-0.5 border-b px-4 py-3"><CardTitle className="text-sm font-semibold">{title}</CardTitle>{subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}</CardHeader><CardContent className="p-0">{children}</CardContent></Card>;
}

function CompactRow({ title, meta, aside }: { title: string; meta?: string; aside?: React.ReactNode }) {
  return <div className="flex min-h-14 flex-col gap-2 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate font-medium">{title}</p>{meta && <p className="truncate text-xs text-muted-foreground">{meta}</p>}</div>{aside && <div className="flex shrink-0 items-center gap-2 text-xs">{aside}</div>}</div>;
}

function Empty({ children }: { children: React.ReactNode }) { return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>; }

function Setting({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange(value: boolean): void }) {
  return <label className="flex min-h-11 items-center justify-between gap-4 rounded-md border px-3 py-2 text-sm"><span className="font-medium">{label}</span><Switch checked={checked} disabled={disabled} onCheckedChange={onChange} /></label>;
}

function PercentageSetting({ label, valueBps, disabled, onSave }: { label: string; valueBps: number; disabled?: boolean; onSave(valueBps: number): void }) {
  return <div className="rounded-md border px-3 py-2"><Label className="text-xs font-medium">{label}</Label><div className="mt-1 flex items-center gap-2"><Input className="h-8 text-sm" key={valueBps} type="number" min="0" max="100" step="0.01" disabled={disabled} defaultValue={Number(valueBps ?? 0) / 100} onBlur={(event) => { const value = Math.round(Number(event.target.value.replace(",", ".")) * 100); if (Number.isInteger(value) && value >= 0 && value <= 10000 && value !== valueBps) onSave(value); }} /><span className="text-xs text-muted-foreground">%</span></div></div>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <Card className="shadow-sm"><CardContent className="p-3 sm:p-4"><p className="text-[11px] font-medium text-muted-foreground sm:text-xs">{label}</p><p className="mt-0.5 text-lg font-semibold tracking-tight sm:text-xl">{value}</p></CardContent></Card>;
}
