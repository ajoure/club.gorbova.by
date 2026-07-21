/* eslint-disable @typescript-eslint/no-explicit-any -- removed after Lovable regenerates Supabase types */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { formatBynMinor, referralStatusLabel } from "@/lib/referrals";

export default function AdminReferrals() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-referrals-overview"],
    queryFn: async () => {
      const client = supabase as any;
      const [settings, partners, sales, entries, payouts] = await Promise.all([
        client.from("referral_program_settings").select("*").eq("singleton", true).single(),
        client.from("referral_partners").select("id,public_id,partner_code,status,joined_at,profiles:profile_id(full_name,email)").order("joined_at", { ascending: false }),
        client.from("referral_sale_attributions").select("id,status,commission_minor,reversed_minor"),
        client.from("referral_balance_entries").select("partner_id,bucket,amount_minor"),
        client.from("referral_payout_requests").select("id,public_id,partner_id,amount_minor,status,requested_at,payment_reference").order("requested_at", { ascending: false }).limit(50),
      ]);
      for (const result of [settings, partners, sales, entries, payouts]) if (result.error) throw result.error;
      return { settings: settings.data, partners: partners.data ?? [], sales: sales.data ?? [], entries: entries.data ?? [], payouts: payouts.data ?? [] };
    },
  });

  const updateSettings = useMutation({
    mutationFn: async (updates: Record<string, boolean>) => {
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
    <div><h1 className="text-2xl font-bold flex items-center gap-2"><Gift className="h-6 w-6" /> Реферальная программа</h1><p className="text-muted-foreground mt-1">10% за отдельные покупки приглашённых, без автоматических продлений.</p></div>
    <Card><CardHeader><CardTitle>Запуск программы</CardTitle></CardHeader><CardContent className="grid sm:grid-cols-2 gap-4">
      <Setting label="Программа включена" checked={data.settings.is_enabled} onChange={(value) => updateSettings.mutate({ is_enabled: value })} />
      <Setting label="Ссылки и привязка" checked={data.settings.tracking_enabled} onChange={(value) => updateSettings.mutate({ tracking_enabled: value })} />
      <Setting label="Кабинет партнёра" checked={data.settings.partner_portal_enabled} onChange={(value) => updateSettings.mutate({ partner_portal_enabled: value })} />
      <Setting label="Реальные начисления" checked={data.settings.accrual_enabled && !data.settings.shadow_mode} onChange={(value) => updateSettings.mutate({ accrual_enabled: value, shadow_mode: !value })} />
      <Setting label="Заявки на выплату" checked={data.settings.payout_requests_enabled} onChange={(value) => updateSettings.mutate({ payout_requests_enabled: value })} />
      <p className="sm:col-span-2 text-xs text-muted-foreground">Включайте реальные начисления только после shadow-проверки в Lovable Cloud. Миграция первоначально оставляет все переключатели выключенными.</p>
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

function Setting({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return <label className="flex items-center justify-between gap-4 rounded-md border p-3 text-sm"><span>{label}</span><Switch checked={checked} onCheckedChange={onChange} /></label>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold mt-1">{value}</p></CardContent></Card>;
}
