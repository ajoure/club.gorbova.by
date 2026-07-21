/* eslint-disable @typescript-eslint/no-explicit-any -- removed after Lovable regenerates Supabase types */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Gift, Loader2, Users, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildReferralLink, formatBynMinor, REFERRAL_STORAGE_KEY, referralStatusLabel } from "@/lib/referrals";

type DashboardData = {
  partner: null | { id: string; public_id: string; partner_code: string; status: string };
  balances?: { pending_minor: number; available_minor: number; held_minor: number; paid_minor: number; currency: "BYN" };
  payouts?: { enabled: boolean; minimum_payout_minor: number };
  referrals?: Array<{ relationship_id: string; display_name: string; attached_at: string; sales_count: number; commission_minor: number }>;
  sales?: Array<{ id: string; public_id: string; created_at: string; status: string; basis_minor: number; commission_minor: number; reversed_minor: number; product_name: string }>;
};

const rpc = (name: string, args?: Record<string, unknown>) => (supabase.rpc as any)(name, args);

export function ReferralDashboardCard() {
  const qc = useQueryClient();

  const partnerQuery = useQuery({
    queryKey: ["referral-current-partner"],
    queryFn: async () => {
      const { data, error } = await rpc("referral_ensure_current_partner");
      if (error) throw error;
      return data as { enabled: boolean };
    },
    retry: false,
  });

  const dashboardQuery = useQuery({
    queryKey: ["referral-dashboard"],
    enabled: partnerQuery.data?.enabled === true,
    queryFn: async () => {
      const { data, error } = await rpc("referral_get_my_dashboard");
      if (error) throw error;
      return data as DashboardData;
    },
  });

  const attachMutation = useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await rpc("referral_attach_current_profile", { p_partner_code: code });
      if (error) throw error;
      return data as { attached: boolean; reason?: string };
    },
    onSettled: () => {
      localStorage.removeItem(REFERRAL_STORAGE_KEY);
      qc.invalidateQueries({ queryKey: ["referral-dashboard"] });
    },
  });

  const payoutMutation = useMutation({
    mutationFn: async () => {
      const raw = window.prompt("Введите сумму выплаты в BYN", (Number(dashboardQuery.data?.balances?.available_minor ?? 0) / 100).toFixed(2));
      if (!raw) return;
      const amountMinor = Math.round(Number(raw.replace(",", ".")) * 100);
      if (!Number.isFinite(amountMinor) || amountMinor <= 0) throw new Error("Введите корректную сумму");
      const { error } = await rpc("referral_create_payout_request", { p_amount_minor: amountMinor });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Заявка на выплату создана"); qc.invalidateQueries({ queryKey: ["referral-dashboard"] }); },
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    if (partnerQuery.data?.enabled !== true || attachMutation.isPending) return;
    const code = localStorage.getItem(REFERRAL_STORAGE_KEY);
    if (code) attachMutation.mutate(code);
  }, [partnerQuery.data?.enabled, attachMutation]);

  if (partnerQuery.isLoading || dashboardQuery.isLoading) {
    return <Card><CardContent className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></CardContent></Card>;
  }
  if (!partnerQuery.data?.enabled || !dashboardQuery.data?.partner) return null;

  const data = dashboardQuery.data;
  const link = buildReferralLink(data.partner.partner_code);
  const balances = data.balances ?? { pending_minor: 0, available_minor: 0, held_minor: 0, paid_minor: 0, currency: "BYN" as const };

  const copyLink = async () => {
    await navigator.clipboard.writeText(link);
    toast.success("Реферальная ссылка скопирована");
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-primary/5">
        <CardTitle className="flex items-center gap-2 text-lg"><Gift className="h-5 w-5" /> Реферальная программа</CardTitle>
        <p className="text-sm text-muted-foreground">Получайте 10% от каждой отдельной покупки приглашённого. Автопродления не учитываются.</p>
      </CardHeader>
      <CardContent className="pt-5 space-y-5">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="min-w-0 flex-1 rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs truncate">{link}</div>
          <Button onClick={copyLink} className="gap-2"><Copy className="h-4 w-4" /> Копировать</Button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Balance label="Ожидает" value={formatBynMinor(balances.pending_minor)} />
          <Balance label="К выплате" value={formatBynMinor(balances.available_minor)} />
          <Balance label="Зарезервировано" value={formatBynMinor(balances.held_minor)} />
          <Balance label="Выплачено" value={formatBynMinor(balances.paid_minor)} />
        </div>
        {data.payouts?.enabled && balances.available_minor > 0 && (
          <div className="flex justify-end"><Button variant="outline" onClick={() => payoutMutation.mutate()} disabled={payoutMutation.isPending}>Запросить выплату</Button></div>
        )}

        <div className="grid md:grid-cols-2 gap-5">
          <section>
            <h3 className="font-medium flex items-center gap-2 mb-3"><Users className="h-4 w-4" /> Приглашённые</h3>
            <div className="space-y-2">
              {(data.referrals ?? []).slice(0, 5).map((item) => (
                <div key={item.relationship_id} className="rounded-md border p-3 flex justify-between gap-3 text-sm">
                  <div><p className="font-medium">{item.display_name}</p><p className="text-muted-foreground">Покупок: {item.sales_count}</p></div>
                  <span className="font-medium">{formatBynMinor(item.commission_minor)}</span>
                </div>
              ))}
              {(data.referrals ?? []).length === 0 && <p className="text-sm text-muted-foreground">Пока никто не зарегистрировался по вашей ссылке.</p>}
            </div>
          </section>
          <section>
            <h3 className="font-medium flex items-center gap-2 mb-3"><WalletCards className="h-4 w-4" /> Последние продажи</h3>
            <div className="space-y-2">
              {(data.sales ?? []).slice(0, 5).map((sale) => (
                <div key={sale.id} className="rounded-md border p-3 text-sm">
                  <div className="flex justify-between gap-3"><p className="font-medium truncate">{sale.product_name}</p><span>{formatBynMinor(sale.commission_minor - sale.reversed_minor)}</span></div>
                  <Badge variant="secondary" className="mt-2">{referralStatusLabel(sale.status)}</Badge>
                </div>
              ))}
              {(data.sales ?? []).length === 0 && <p className="text-sm text-muted-foreground">Продаж по вашей ссылке пока нет.</p>}
            </div>
          </section>
        </div>
      </CardContent>
    </Card>
  );
}

function Balance({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold mt-1">{value}</p></div>;
}
