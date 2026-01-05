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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShoppingCart,
  Search,
  MoreHorizontal,
  Eye,
  Copy,
  RefreshCw,
  Filter,
  Package,
  CreditCard,
  Clock,
  CheckCircle,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";

const ORDER_STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Черновик", variant: "secondary" },
  pending: { label: "Ожидает оплаты", variant: "outline" },
  paid: { label: "Оплачен", variant: "default" },
  partial: { label: "Частично оплачен", variant: "outline" },
  cancelled: { label: "Отменён", variant: "destructive" },
  refunded: { label: "Возврат", variant: "destructive" },
  expired: { label: "Истёк", variant: "secondary" },
};

export default function AdminOrdersV2() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { isSuperAdmin } = usePermissions();
  const queryClient = useQueryClient();

  // Mutation for test payment completion
  const testPaymentMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('test-payment-complete', {
        body: { orderId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success('Оплата успешно подтверждена (тест)', {
        description: `GetCourse: ${data.results?.getcourse_sync || 'N/A'}, Telegram: ${data.results?.telegram_access_granted || 0} клубов`,
      });
      queryClient.invalidateQueries({ queryKey: ['orders-v2'] });
      refetch();
    },
    onError: (error: any) => {
      toast.error('Ошибка подтверждения оплаты', {
        description: error.message,
      });
    },
  });

  const { data: orders, isLoading, refetch } = useQuery({
    queryKey: ["orders-v2", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("orders_v2")
        .select(`
          *,
          products_v2(id, name, code),
          tariffs(id, name, code),
          flows(id, name, code)
        `)
        .order("created_at", { ascending: false })
        .limit(100);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter as "draft" | "pending" | "paid" | "partial" | "canceled" | "refunded" | "failed");
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["orders-v2-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders_v2")
        .select("status, final_price");
      
      if (error) throw error;
      
      const total = data?.length || 0;
      const paid = data?.filter((o) => o.status === "paid").length || 0;
      const pending = data?.filter((o) => o.status === "pending").length || 0;
      const totalRevenue = data
        ?.filter((o) => o.status === "paid")
        .reduce((sum, o) => sum + Number(o.final_price || 0), 0) || 0;

      return { total, paid, pending, totalRevenue };
    },
  });

  const filteredOrders = orders?.filter((order) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      order.order_number?.toLowerCase().includes(query) ||
      order.customer_email?.toLowerCase().includes(query) ||
      order.customer_phone?.includes(query) ||
      order.products_v2?.name?.toLowerCase().includes(query)
    );
  });

  const copyOrderId = (id: string) => {
    navigator.clipboard.writeText(id);
    toast.success("ID заказа скопирован");
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShoppingCart className="h-6 w-6" />
              Заказы v2
            </h1>
            <p className="text-muted-foreground">Управление заказами продуктовой системы</p>
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
                Всего заказов
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Оплачено
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats?.paid || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Ожидает оплаты
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{stats?.pending || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Выручка
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {new Intl.NumberFormat("ru-BY", { style: "currency", currency: "BYN" }).format(stats?.totalRevenue || 0)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по номеру, email, телефону..."
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
              {Object.entries(ORDER_STATUS_LABELS).map(([value, { label }]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Orders table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : !filteredOrders?.length ? (
              <div className="p-12 text-center text-muted-foreground">
                <ShoppingCart className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>Нет заказов</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Номер</TableHead>
                    <TableHead>Клиент</TableHead>
                    <TableHead>Продукт / Тариф</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Дата</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.map((order) => {
                    const statusConfig = ORDER_STATUS_LABELS[order.status] || { label: order.status, variant: "secondary" as const };
                    return (
                      <TableRow key={order.id}>
                        <TableCell>
                          <div className="font-mono text-sm">{order.order_number}</div>
                          {order.is_trial && (
                            <Badge variant="outline" className="text-xs mt-1">Trial</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">
                            {order.customer_email || "—"}
                          </div>
                          {order.customer_phone && (
                            <div className="text-xs text-muted-foreground">{order.customer_phone}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Package className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <div className="font-medium">
                                {(order.products_v2 as any)?.name || "—"}
                              </div>
                              {order.tariffs && (
                                <div className="text-xs text-muted-foreground">
                                  {(order.tariffs as any)?.name}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="font-medium">
                            {new Intl.NumberFormat("ru-BY", { style: "currency", currency: order.currency }).format(Number(order.final_price))}
                          </div>
                          {order.discount_percent && Number(order.discount_percent) > 0 && (
                            <div className="text-xs text-green-600">-{order.discount_percent}%</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {format(new Date(order.created_at), "dd.MM.yy HH:mm", { locale: ru })}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => copyOrderId(order.id)}>
                                <Copy className="h-4 w-4 mr-2" />
                                Копировать ID
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <Eye className="h-4 w-4 mr-2" />
                                Подробнее
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <CreditCard className="h-4 w-4 mr-2" />
                                Платежи
                              </DropdownMenuItem>
                              {isSuperAdmin() && order.status !== 'paid' && order.status !== 'refunded' && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem 
                                    onClick={() => testPaymentMutation.mutate(order.id)}
                                    disabled={testPaymentMutation.isPending}
                                    className="text-green-600"
                                  >
                                    <CheckCircle className="h-4 w-4 mr-2" />
                                    {testPaymentMutation.isPending ? 'Обработка...' : 'Оплата получена (тест)'}
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
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
    </AdminLayout>
  );
}
