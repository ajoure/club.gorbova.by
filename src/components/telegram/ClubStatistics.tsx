import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import { format, subDays, startOfDay, eachDayOfInterval } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, Users, UserPlus, UserMinus, Target } from 'lucide-react';

interface ClubStatisticsProps {
  clubId: string;
}

const COLORS = ['hsl(var(--primary))', 'hsl(var(--secondary))', 'hsl(var(--accent))', 'hsl(var(--muted))'];

export function ClubStatistics({ clubId }: ClubStatisticsProps) {
  // Fetch access grants for activity chart
  const { data: grantsData, isLoading: grantsLoading } = useQuery({
    queryKey: ['club-grants-stats', clubId],
    queryFn: async () => {
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
      const { data, error } = await supabase
        .from('telegram_access_grants')
        .select('created_at, source, status, revoked_at')
        .eq('club_id', clubId)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch logs for activity
  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ['club-logs-stats', clubId],
    queryFn: async () => {
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
      const { data, error } = await supabase
        .from('telegram_logs')
        .select('created_at, action, status')
        .eq('club_id', clubId)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
  });

  // Calculate activity chart data (last 30 days)
  const activityData = useMemo(() => {
    if (!grantsData) return [];

    const days = eachDayOfInterval({
      start: subDays(new Date(), 29),
      end: new Date(),
    });

    return days.map(day => {
      const dayStart = startOfDay(day);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const dayGrants = grantsData.filter(g => {
        const created = new Date(g.created_at);
        return created >= dayStart && created < dayEnd;
      });

      const dayRevokes = grantsData.filter(g => {
        if (!g.revoked_at) return false;
        const revoked = new Date(g.revoked_at);
        return revoked >= dayStart && revoked < dayEnd;
      });

      return {
        date: format(day, 'dd.MM', { locale: ru }),
        fullDate: format(day, 'd MMMM', { locale: ru }),
        granted: dayGrants.length,
        revoked: dayRevokes.length,
        net: dayGrants.length - dayRevokes.length,
      };
    });
  }, [grantsData]);

  // Calculate source distribution
  const sourceData = useMemo(() => {
    if (!grantsData) return [];

    const sourceMap: Record<string, number> = {};
    grantsData.forEach(grant => {
      const source = grant.source || 'unknown';
      sourceMap[source] = (sourceMap[source] || 0) + 1;
    });

    const sourceLabels: Record<string, string> = {
      manual: 'Ручная выдача',
      payment: 'Оплата',
      invite: 'Инвайт-код',
      system: 'Система',
      unknown: 'Неизвестно',
    };

    return Object.entries(sourceMap).map(([source, count]) => ({
      name: sourceLabels[source] || source,
      value: count,
    }));
  }, [grantsData]);

  // Calculate conversion stats
  const stats = useMemo(() => {
    if (!grantsData || !logsData) return null;

    const totalGranted = grantsData.length;
    const totalRevoked = grantsData.filter(g => g.status === 'revoked').length;
    const activeNow = grantsData.filter(g => g.status === 'active').length;
    
    const retentionRate = totalGranted > 0 
      ? Math.round((activeNow / totalGranted) * 100) 
      : 0;

    const manualGrants = grantsData.filter(g => g.source === 'manual').length;
    const paidGrants = grantsData.filter(g => g.source === 'payment').length;
    const inviteGrants = grantsData.filter(g => g.source === 'invite').length;

    return {
      totalGranted,
      totalRevoked,
      activeNow,
      retentionRate,
      manualGrants,
      paidGrants,
      inviteGrants,
    };
  }, [grantsData, logsData]);

  if (grantsLoading || logsLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Всего выдано доступов</CardDescription>
            <UserPlus className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalGranted || 0}</div>
            <p className="text-xs text-muted-foreground">за 30 дней</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Отозвано доступов</CardDescription>
            <UserMinus className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalRevoked || 0}</div>
            <p className="text-xs text-muted-foreground">за 30 дней</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Активных сейчас</CardDescription>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.activeNow || 0}</div>
            <p className="text-xs text-muted-foreground">участников с доступом</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Удержание</CardDescription>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">{stats?.retentionRate || 0}%</span>
              {(stats?.retentionRate || 0) >= 70 ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">активных / выданных</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Activity Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Динамика за 30 дней</CardTitle>
            <CardDescription>Выданные и отозванные доступы</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activityData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    className="text-muted-foreground"
                  />
                  <YAxis 
                    tick={{ fontSize: 12 }}
                    className="text-muted-foreground"
                  />
                  <Tooltip 
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const data = payload[0]?.payload;
                      return (
                        <div className="rounded-lg border bg-background p-2 shadow-sm">
                          <div className="font-medium">{data?.fullDate}</div>
                          <div className="text-sm text-green-600">Выдано: {data?.granted}</div>
                          <div className="text-sm text-red-600">Отозвано: {data?.revoked}</div>
                        </div>
                      );
                    }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="granted" 
                    stackId="1"
                    stroke="hsl(var(--primary))" 
                    fill="hsl(var(--primary))" 
                    fillOpacity={0.3}
                    name="Выдано"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="revoked" 
                    stackId="2"
                    stroke="hsl(var(--destructive))" 
                    fill="hsl(var(--destructive))" 
                    fillOpacity={0.3}
                    name="Отозвано"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Source Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Источники доступа</CardTitle>
            <CardDescription>Как пользователи получили доступ</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {sourceData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sourceData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {sourceData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  Нет данных за выбранный период
                </div>
              )}
            </div>
            
            {/* Legend */}
            <div className="flex flex-wrap gap-4 justify-center mt-4">
              {sourceData.map((entry, index) => (
                <div key={entry.name} className="flex items-center gap-2">
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="text-sm">{entry.name}: {entry.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Source breakdown cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Оплаты</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.paidGrants || 0}</div>
            <Badge variant="outline" className="mt-1">
              {stats?.totalGranted && stats.paidGrants 
                ? Math.round((stats.paidGrants / stats.totalGranted) * 100) 
                : 0}% от общего
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Ручные выдачи</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.manualGrants || 0}</div>
            <Badge variant="outline" className="mt-1">
              {stats?.totalGranted && stats.manualGrants 
                ? Math.round((stats.manualGrants / stats.totalGranted) * 100) 
                : 0}% от общего
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>По инвайт-кодам</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.inviteGrants || 0}</div>
            <Badge variant="outline" className="mt-1">
              {stats?.totalGranted && stats.inviteGrants 
                ? Math.round((stats.inviteGrants / stats.totalGranted) * 100) 
                : 0}% от общего
            </Badge>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
