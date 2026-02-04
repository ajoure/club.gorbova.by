import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, AlertTriangle, CheckCircle, Link2, Link2Off, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface ProviderSubscription {
  id: string;
  provider: string;
  provider_subscription_id: string;
  user_id: string;
  subscription_v2_id: string | null;
  profile_id: string | null;
  state: string;
  amount_cents: number | null;
  currency: string | null;
  interval_days: number | null;
  created_at: string;
  updated_at: string | null;
  raw_data: Record<string, unknown> | null;
  // Joined data
  profiles?: { full_name: string | null } | null;
  subscriptions_v2?: { 
    status: string; 
    billing_type: string;
    products_v2?: { name: string } | null;
    tariffs?: { name: string } | null;
  } | null;
}

// State badge colors
const stateColors: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  trial: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  expired: "bg-muted text-muted-foreground",
};

export default function AdminBepaidSubscriptions() {
  const { data: providerSubs, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['admin-provider-subscriptions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_subscriptions')
        .select(`
          *,
          profiles:profile_id(full_name),
          subscriptions_v2:subscription_v2_id(
            status, 
            billing_type,
            products_v2:product_id(name),
            tariffs:tariff_id(name)
          )
        `)
        .eq('provider', 'bepaid')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as ProviderSubscription[];
    },
  });

  // Separate linked vs unlinked
  const linkedSubs = providerSubs?.filter(s => s.subscription_v2_id) || [];
  const unlinkedSubs = providerSubs?.filter(s => !s.subscription_v2_id) || [];

  const formatAmount = (cents: number | null, currency: string | null) => {
    if (!cents) return '—';
    return `${(cents / 100).toFixed(2)} ${currency || 'BYN'}`;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return format(new Date(dateStr), 'dd MMM yyyy HH:mm', { locale: ru });
  };

  const renderSubscriptionRow = (sub: ProviderSubscription, showLinked = true) => (
    <TableRow key={sub.id}>
      <TableCell className="font-mono text-xs">
        {sub.provider_subscription_id.slice(0, 8)}...
      </TableCell>
      <TableCell>
        <Badge className={stateColors[sub.state] || stateColors.expired}>
          {sub.state}
        </Badge>
      </TableCell>
      <TableCell>
        {formatAmount(sub.amount_cents, sub.currency)}
        {sub.interval_days && (
          <span className="text-xs text-muted-foreground ml-1">
            / {sub.interval_days}д
          </span>
        )}
      </TableCell>
      <TableCell>
        {sub.profiles?.full_name || '—'}
      </TableCell>
      {showLinked && (
        <TableCell>
          {sub.subscription_v2_id ? (
            <div className="flex items-center gap-1">
              <Link2 className="h-3 w-3 text-green-600" />
              <span className="text-xs">
                {sub.subscriptions_v2?.products_v2?.name || 'Продукт'}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-destructive">
              <Link2Off className="h-3 w-3" />
              <span className="text-xs">Не связано</span>
            </div>
          )}
        </TableCell>
      )}
      <TableCell className="text-xs text-muted-foreground">
        {formatDate(sub.created_at)}
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            // Open bePaid admin (if accessible)
            window.open(`https://admin.bepaid.by/subscriptions/${sub.provider_subscription_id}`, '_blank');
          }}
        >
          <ExternalLink className="h-3 w-3" />
        </Button>
      </TableCell>
    </TableRow>
  );

  return (
    <AdminLayout>
      <div className="px-3 md:px-4 pb-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">bePaid Subscriptions</h1>
            <p className="text-muted-foreground">
              Диагностика подписок bePaid — связанные и несвязанные
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Всего подписок</CardDescription>
              <CardTitle className="text-2xl">{providerSubs?.length || 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <CheckCircle className="h-3 w-3 text-green-600" />
                Связанные
              </CardDescription>
              <CardTitle className="text-2xl text-green-600">{linkedSubs.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card className={unlinkedSubs.length > 0 ? 'border-destructive' : ''}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-destructive" />
                Не связанные (unknown_origin)
              </CardDescription>
              <CardTitle className="text-2xl text-destructive">{unlinkedSubs.length}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="all" className="space-y-4">
          <TabsList>
            <TabsTrigger value="all">Все ({providerSubs?.length || 0})</TabsTrigger>
            <TabsTrigger value="linked">Связанные ({linkedSubs.length})</TabsTrigger>
            <TabsTrigger value="unlinked" className={unlinkedSubs.length > 0 ? 'text-destructive' : ''}>
              Не связанные ({unlinkedSubs.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all">
            <Card>
              <CardHeader>
                <CardTitle>Все bePaid подписки</CardTitle>
                <CardDescription>
                  Подписки, созданные через bePaid Subscriptions API
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Статус</TableHead>
                        <TableHead>Сумма</TableHead>
                        <TableHead>Клиент</TableHead>
                        <TableHead>Связь</TableHead>
                        <TableHead>Создано</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {providerSubs?.map(sub => renderSubscriptionRow(sub))}
                      {!providerSubs?.length && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                            Нет данных
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="linked">
            <Card>
              <CardHeader>
                <CardTitle>Связанные подписки</CardTitle>
                <CardDescription>
                  Подписки с привязкой к subscriptions_v2
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Сумма</TableHead>
                      <TableHead>Клиент</TableHead>
                      <TableHead>Связь</TableHead>
                      <TableHead>Создано</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linkedSubs.map(sub => renderSubscriptionRow(sub))}
                    {!linkedSubs.length && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          Нет связанных подписок
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="unlinked">
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  Не связанные подписки (unknown_origin)
                </CardTitle>
                <CardDescription>
                  Подписки bePaid без связи с subscriptions_v2. Требуют ручного разбора.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {unlinkedSubs.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Статус</TableHead>
                        <TableHead>Сумма</TableHead>
                        <TableHead>Клиент</TableHead>
                        <TableHead>Создано</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unlinkedSubs.map(sub => renderSubscriptionRow(sub, false))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-600" />
                    <p>Все подписки связаны. Отлично!</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
