/* eslint-disable @typescript-eslint/no-explicit-any -- removed after Lovable regenerates Supabase types */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buildReferralLink, formatBynMinor, referralStatusLabel } from "@/lib/referrals";

export function ContactReferralsTab({ profileId }: { profileId: string }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["contact-referrals", profileId],
    queryFn: async () => {
      const client = supabase as any;
      const { data: partner, error } = await client.from("referral_partners").select("*").eq("profile_id", profileId).maybeSingle();
      if (error) throw error;
      if (!partner) return { partner: null, referrals: [], sales: [], entries: [] };
      const [relationships, sales, entries] = await Promise.all([
        client.from("referral_relationships").select("id, referred_profile_id, attached_at, status, profiles:referred_profile_id(full_name,email)").eq("partner_id", partner.id).order("attached_at", { ascending: false }),
        client.from("referral_sale_attributions").select("id, public_id, status, commission_minor, reversed_minor, created_at, products_v2(name)").eq("partner_id", partner.id).order("created_at", { ascending: false }),
        client.from("referral_balance_entries").select("bucket,amount_minor").eq("partner_id", partner.id),
      ]);
      if (relationships.error) throw relationships.error;
      if (sales.error) throw sales.error;
      if (entries.error) throw entries.error;
      return { partner, referrals: relationships.data ?? [], sales: sales.data ?? [], entries: entries.data ?? [] };
    },
  });

  const createPartner = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.rpc as any)("referral_admin_ensure_partner", { p_profile_id: profileId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Реферальный кабинет подключён");
      qc.invalidateQueries({ queryKey: ["contact-referrals", profileId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (query.isLoading) return <div className="py-12 flex justify-center"><Loader2 className="animate-spin" /></div>;
  if (query.error) return <p className="text-sm text-destructive">Не удалось загрузить реферальные данные.</p>;
  const data = query.data!;

  if (!data.partner) {
    return (
      <Card><CardContent className="py-10 text-center space-y-4">
        <Users className="h-10 w-10 mx-auto text-muted-foreground" />
        <div><p className="font-medium">Реферальный кабинет не подключён</p><p className="text-sm text-muted-foreground">После подключения контакт получит постоянную ссылку для приглашений.</p></div>
        <Button onClick={() => createPartner.mutate()} disabled={createPartner.isPending} className="gap-2"><UserPlus className="h-4 w-4" /> Подключить</Button>
      </CardContent></Card>
    );
  }

  const totals = data.entries.reduce((acc: Record<string, number>, row: any) => {
    acc[row.bucket] = (acc[row.bucket] ?? 0) + Number(row.amount_minor);
    return acc;
  }, {});
  const link = buildReferralLink(data.partner.partner_code);

  return <div className="space-y-4">
    <Card><CardHeader><CardTitle className="text-base flex items-center justify-between gap-2">Партнёр <Badge>{referralStatusLabel(data.partner.status)}</Badge></CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2"><div className="flex-1 min-w-0 border rounded-md px-3 py-2 font-mono text-xs truncate">{link}</div><Button variant="outline" size="icon" onClick={async () => { await navigator.clipboard.writeText(link); toast.success("Ссылка скопирована"); }}><Copy className="h-4 w-4" /></Button></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <Metric label="Ожидает" value={formatBynMinor(totals.pending)} />
          <Metric label="К выплате" value={formatBynMinor(totals.available)} />
          <Metric label="В резерве" value={formatBynMinor(totals.held)} />
          <Metric label="Выплачено" value={formatBynMinor(totals.paid)} />
        </div>
      </CardContent>
    </Card>
    <Card><CardHeader><CardTitle className="text-base">Приглашённые ({data.referrals.length})</CardTitle></CardHeader><CardContent className="space-y-2">
      {data.referrals.map((row: any) => <div key={row.id} className="border rounded-md p-3 text-sm flex justify-between"><div><p className="font-medium">{row.profiles?.full_name || "Пользователь"}</p><p className="text-muted-foreground">{row.profiles?.email || "Email не указан"}</p></div><Badge variant="secondary">{referralStatusLabel(row.status)}</Badge></div>)}
      {!data.referrals.length && <p className="text-sm text-muted-foreground">Приглашённых пока нет.</p>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Начисления</CardTitle></CardHeader><CardContent className="space-y-2">
      {data.sales.map((sale: any) => <div key={sale.id} className="border rounded-md p-3 text-sm flex justify-between gap-3"><div><p className="font-medium">{sale.products_v2?.name || "Продукт"}</p><Badge variant="secondary" className="mt-1">{referralStatusLabel(sale.status)}</Badge></div><span className="font-medium">{formatBynMinor(Number(sale.commission_minor) - Number(sale.reversed_minor))}</span></div>)}
      {!data.sales.length && <p className="text-sm text-muted-foreground">Начислений пока нет.</p>}
    </CardContent></Card>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border rounded-md p-2"><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium mt-1">{value}</p></div>;
}
