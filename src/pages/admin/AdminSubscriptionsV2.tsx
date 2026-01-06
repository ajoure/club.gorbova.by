import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  Search,
  RefreshCw,
  Filter,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Calendar,
  CreditCard,
  Settings,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, formatDistanceToNow, isBefore } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { SubscriptionActionsSheet } from "@/components/admin/SubscriptionActionsSheet";

const SUBSCRIPTION_STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle; className: string }> = {
  active: { label: "Активна", icon: CheckCircle, className: "text-green-600" },
  trial: { label: "Пробный период", icon: Clock, className: "text-blue-600" },
  past_due: { label: "Просрочена", icon: AlertTriangle, className: "text-amber-600" },
  paused: { label: "Приостановлена", icon: Clock, className: "text-orange-600" },
  cancelled: { label: "Отменена", icon: XCircle, className: "text-muted-foreground" },
  canceled: { label: "Отменена", icon: XCircle, className: "text-muted-foreground" },
  expired: { label: "Истекла", icon: XCircle, className: "text-destructive" },
};

export default function AdminSubscriptionsV2() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedSubscription, setSelectedSubscription] = useState<any>(null);

  const { data: subscriptions, isLoading, refetch } = useQuery({
    queryKey: ["subscriptions-v2", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("subscriptions_v2")
        .select(`
          *,
          products_v2(id, name, code),
          tariffs(id, name, code, access_days),
          flows(id, name)
        `)
        .order("created_at", { ascending: false })
        .limit(100);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter as "active" | "trial" | "past_due" | "canceled" | "expired");
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["subscriptions-v2-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions_v2")
        .select("status, is_trial");
      
      if (error) throw error;
      
      const total = data?.length || 0;
      const active = data?.filter((s) => s.status === "active").length || 0;
      const trial = data?.filter((s) => s.status === "trial" || s.is_trial).length || 0;
      const pastDue = data?.filter((s) => s.status === "past_due").length || 0;

      return { total, active, trial, pastDue };
    },
  });

  const filteredSubscriptions = subscriptions?.filter((sub) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const product = sub.products_v2 as any;
    return (
      product?.name?.toLowerCase().includes(query) ||
      (sub as any).user_id?.includes(query)
    );
  });

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6" />
              Подписки v2
            </h1>
            <p className="text-muted-foreground">Управление подписками и доступами</p>
          </div>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Обновить
          </Button>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Всего подписок
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Активных
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats?.active || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Trial
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats?.trial || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Просрочено
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{stats?.pastDue || 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по имени, email, продукту..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Статус" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              {Object.entries(SUBSCRIPTION_STATUS_CONFIG).map(([value, { label }]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Subscriptions table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : !filteredSubscriptions?.length ? (
              <div className="p-12 text-center text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>Нет подписок</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Пользователь</TableHead>
                    <TableHead>Продукт / Тариф</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Период доступа</TableHead>
                    <TableHead>Следующее списание</TableHead>
                    <TableHead>Дата создания</TableHead>
                    <TableHead className="w-[80px]">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSubscriptions.map((sub) => {
                    const product = sub.products_v2 as any;
                    const tariff = sub.tariffs as any;
                    const statusConfig = SUBSCRIPTION_STATUS_CONFIG[sub.status] || 
                      { label: sub.status, icon: Clock, className: "text-muted-foreground" };
                    const StatusIcon = statusConfig.icon;

                    const accessEndDate = sub.access_end_at ? new Date(sub.access_end_at) : null;
                    const isExpiringSoon = accessEndDate && 
                      isBefore(accessEndDate, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

                    return (
                      <TableRow key={sub.id}>
                        <TableCell>
                          <div className="font-medium">
                            User: {sub.user_id?.slice(0, 8)}...
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{product?.name || "—"}</div>
                          {tariff && (
                            <div className="text-xs text-muted-foreground">
                              {tariff.name} ({tariff.access_days} дней)
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className={cn("flex items-center gap-2", statusConfig.className)}>
                            <StatusIcon className="h-4 w-4" />
                            <span>{statusConfig.label}</span>
                          </div>
                          {sub.is_trial && (
                            <Badge variant="outline" className="text-xs mt-1">
                              Trial до {sub.trial_end_at && format(new Date(sub.trial_end_at), "dd.MM")}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <div className="text-sm">
                                {format(new Date(sub.access_start_at), "dd.MM.yy")}
                                {accessEndDate && (
                                  <> — {format(accessEndDate, "dd.MM.yy")}</>
                                )}
                              </div>
                              {accessEndDate && (
                                <div className={cn(
                                  "text-xs",
                                  isExpiringSoon ? "text-amber-600" : "text-muted-foreground"
                                )}>
                                  {isBefore(accessEndDate, new Date()) 
                                    ? "Истекла"
                                    : `Осталось ${formatDistanceToNow(accessEndDate, { locale: ru })}`}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {sub.next_charge_at ? (
                            <div className="flex items-center gap-2">
                              <CreditCard className="h-4 w-4 text-muted-foreground" />
                              <div className="text-sm">
                                {format(new Date(sub.next_charge_at), "dd.MM.yy")}
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                          {sub.charge_attempts && sub.charge_attempts > 0 && (
                            <div className="text-xs text-amber-600">
                              Попыток: {sub.charge_attempts}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm text-muted-foreground">
                            {format(new Date(sub.created_at), "dd.MM.yy HH:mm", { locale: ru })}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedSubscription(sub)}
                          >
                            <Settings className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Subscription Actions Sheet */}
      <SubscriptionActionsSheet
        open={!!selectedSubscription}
        onOpenChange={(open) => !open && setSelectedSubscription(null)}
        subscription={selectedSubscription}
      />
    </AdminLayout>
  );
}
