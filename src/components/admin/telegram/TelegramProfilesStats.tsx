import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, MessageCircle, Clock, Link2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function TelegramProfilesStats() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['telegram-profiles-stats'],
    queryFn: async () => {
      // Get total profiles
      const { count: totalProfiles } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      // Get profiles with telegram_user_id
      const { count: withTelegramId } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .not('telegram_user_id', 'is', null);

      // Get profiles with telegram_link_status = 'active'
      const { count: linkedActive } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('telegram_link_status', 'active');

      // Get profiles with telegram_link_status = 'pending'
      const { count: linkedPending } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('telegram_link_status', 'pending');

      return {
        total: totalProfiles || 0,
        withTelegramId: withTelegramId || 0,
        linkedActive: linkedActive || 0,
        linkedPending: linkedPending || 0,
      };
    },
    refetchInterval: 60000, // Refresh every minute
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Профили Telegram</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const statItems = [
    {
      label: 'Всего профилей',
      value: stats?.total || 0,
      icon: Users,
      color: 'text-blue-500',
    },
    {
      label: 'С Telegram ID',
      value: stats?.withTelegramId || 0,
      icon: MessageCircle,
      color: 'text-green-500',
    },
    {
      label: 'Привязаны (active)',
      value: stats?.linkedActive || 0,
      icon: Link2,
      color: 'text-emerald-500',
    },
    {
      label: 'Ожидают (pending)',
      value: stats?.linkedPending || 0,
      icon: Clock,
      color: 'text-amber-500',
    },
  ];

  const percentage = stats?.total 
    ? Math.round((stats.linkedActive / stats.total) * 100) 
    : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>Профили Telegram</span>
          <span className="text-sm font-normal text-muted-foreground">
            {percentage}% привязаны
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {statItems.map((item) => {
            const Icon = item.icon;
            return (
              <div 
                key={item.label} 
                className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
              >
                <div className={`p-2 rounded-md bg-background ${item.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{item.value.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
