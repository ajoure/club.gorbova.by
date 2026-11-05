import { useQuery } from "@tanstack/react-query";
import { Gift } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { bonusEntryLabel, type BonusWallet } from "@/lib/customer-bonus";
import { formatBynMinor } from "@/lib/referrals";

export function CustomerBonusCard() {
  const { user } = useAuth();
  const wallet = useQuery({
    queryKey: ["customer-bonus-wallet", user?.id], enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_customer_bonus_wallet");
      if (error) throw error;
      return data as unknown as BonusWallet;
    },
  });
  if (!user || wallet.isLoading) return null;
  if (wallet.error) return <Card><CardContent className="py-4 text-sm text-muted-foreground">Бонусный баланс временно недоступен.</CardContent></Card>;
  if (!wallet.data?.entries.length && !wallet.data?.available_minor) return null;
  return <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Gift className="h-5 w-5" /> Мои бонусы</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <div><p className="text-sm text-muted-foreground">Доступно для покупок</p><p className="text-2xl font-semibold">{formatBynMinor(Number(wallet.data.available_minor))}</p></div>
      <div className="space-y-2">{wallet.data.entries.map((entry) => <div key={entry.id} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-sm">
        <div><p>{bonusEntryLabel(entry.entry_type)}</p><p className="text-xs text-muted-foreground">{new Date(entry.created_at).toLocaleDateString("ru-BY")}</p></div>
        <p className="font-medium">{entry.amount_minor > 0 ? "+" : ""}{formatBynMinor(Number(entry.amount_minor))}</p>
      </div>)}</div>
    </CardContent>
  </Card>;
}
