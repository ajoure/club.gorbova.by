import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import PaymentMethodBadge from "@/components/admin/payments/PaymentMethodBadge";
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
  CreditCard,
  Search,
  RefreshCw,
  Filter,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";

const PAYMENT_STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle; className: string }> = {
  pending: { label: "Ожидает", icon: Clock, className: "text-amber-600" },
  processing: { label: "Обработка", icon: Loader2, className: "text-blue-600" },
  succeeded: { label: "Успешно", icon: CheckCircle, className: "text-green-600" },
  failed: { label: "Ошибка", icon: XCircle, className: "text-destructive" },
  refunded: { label: "Возврат", icon: XCircle, className: "text-muted-foreground" },
  canceled: { label: "Отменён", icon: XCircle, className: "text-muted-foreground" },
};

export default function AdminPaymentsV2() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: payments, isLoading, refetch } = useQuery({
    queryKey: ["payments-v2", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("payments_v2")
        .select(`
          *,
          orders_v2(id, order_number, products_v2(name))
        `)
        .order("created_at", { ascending: false })
        .limit(100);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter as "pending" | "processing" | "succeeded" | "failed" | "refunded" | "canceled");
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["payments-v2-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments_v2")
        .select("status, amount");
      
      if (error) throw error;
      
      const total = data?.length || 0;
      const completed = data?.filter((p) => p.status === "succeeded").length || 0;
      const failed = data?.filter((p) => p.status === "failed").length || 0;
      const totalAmount = data
        ?.filter((p) => p.status === "succeeded")
        .reduce((sum, p) => sum + Number(p.amount || 0), 0) || 0;

      return { total, completed, failed, totalAmount };
    },
  });

  const filteredPayments = payments?.filter((payment) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const order = payment.orders_v2 as any;
    return (
      order?.order_number?.toLowerCase().includes(query) ||
      payment.provider_payment_id?.toLowerCase().includes(query) ||
      payment.card_last4?.includes(query)
    );
  });

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CreditCard className="h-6 w-6" />
              Платежи v2
            </h1>
            <p className="text-muted-foreground">Управление платежами</p>
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
                Всего платежей
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Успешных
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats?.completed || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Неудачных
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{stats?.failed || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Сумма успешных
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {new Intl.NumberFormat("ru-BY", { style: "currency", currency: "BYN" }).format(stats?.totalAmount || 0)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по номеру заказа, ID платежа..."
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
              {Object.entries(PAYMENT_STATUS_CONFIG).map(([value, { label }]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Payments table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : !filteredPayments?.length ? (
              <div className="p-12 text-center text-muted-foreground">
                <CreditCard className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>Нет платежей</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Заказ</TableHead>
                    <TableHead>Провайдер</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead>Карта</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Дата</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPayments.map((payment) => {
                    const order = payment.orders_v2 as any;
                    const statusConfig = PAYMENT_STATUS_CONFIG[payment.status] || 
                      { label: payment.status, icon: Clock, className: "text-muted-foreground" };
                    const StatusIcon = statusConfig.icon;

                    return (
                      <TableRow key={payment.id}>
                        <TableCell>
                          <div className="font-mono text-sm">
                            {order?.order_number || "—"}
                          </div>
                          {order?.products_v2?.name && (
                            <div className="text-xs text-muted-foreground">
                              {order.products_v2.name}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {payment.provider || "bepaid"}
                          </Badge>
                          {payment.is_recurring && (
                            <Badge variant="secondary" className="ml-1 text-xs">
                              Рекуррент
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {new Intl.NumberFormat("ru-BY", { 
                            style: "currency", 
                            currency: payment.currency 
                          }).format(Number(payment.amount))}
                        </TableCell>
                        <TableCell>
                          <PaymentMethodBadge 
                            cardBrand={payment.card_brand}
                            cardLast4={payment.card_last4}
                            providerResponse={payment.provider_response}
                          />
                        </TableCell>
                        <TableCell>
                          <div className={cn("flex items-center gap-2", statusConfig.className)}>
                            <StatusIcon className={cn(
                              "h-4 w-4",
                              payment.status === "processing" && "animate-spin"
                            )} />
                            <span>{statusConfig.label}</span>
                          </div>
                          {payment.error_message && (
                            <div className="text-xs text-destructive mt-1">
                              {payment.error_message}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm text-muted-foreground">
                            {format(new Date(payment.created_at), "dd.MM.yy HH:mm", { locale: ru })}
                          </div>
                          {payment.paid_at && (
                            <div className="text-xs text-green-600">
                              Оплачен: {format(new Date(payment.paid_at), "HH:mm")}
                            </div>
                          )}
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
