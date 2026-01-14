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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Undo2,
  Search,
  MoreHorizontal,
  RefreshCw,
  Filter,
  Receipt,
  Calculator,
  ExternalLink,
  CheckCircle,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const REFUND_STATUS_CONFIG = {
  none: { label: "Нет возвратов", variant: "secondary" as const, color: "text-muted-foreground" },
  partial: { label: "Частичный", variant: "outline" as const, color: "text-orange-600" },
  full: { label: "Полный", variant: "destructive" as const, color: "text-red-600" },
};

export default function AdminRefundsV2() {
  const [searchQuery, setSearchQuery] = useState("");
  const [refundFilter, setRefundFilter] = useState<string>("has_refunds");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const queryClient = useQueryClient();

  // Fetch payments with refunds
  const { data: payments, isLoading, refetch } = useQuery({
    queryKey: ["refunds-v2", refundFilter],
    queryFn: async () => {
      let query = supabase
        .from("payments_v2")
        .select(`
          *,
          orders_v2(id, order_number, status, meta, customer_email, profile_id, profiles:profile_id(full_name, email)),
          profiles:profile_id(id, full_name, email)
        `)
        .eq("provider", "bepaid")
        .not("provider_payment_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(200);

      // Filter by refund status
      if (refundFilter === "has_refunds") {
        query = query.gt("refunded_amount", 0);
      } else if (refundFilter === "partial") {
        query = query.gt("refunded_amount", 0);
      } else if (refundFilter === "full") {
        query = query.gt("refunded_amount", 0);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Post-process for partial/full filter
      let filtered = data || [];
      if (refundFilter === "partial") {
        filtered = filtered.filter(p => {
          const refunded = Number(p.refunded_amount) || 0;
          const amount = Number(p.amount) || 0;
          return refunded > 0 && refunded < amount;
        });
      } else if (refundFilter === "full") {
        filtered = filtered.filter(p => {
          const refunded = Number(p.refunded_amount) || 0;
          const amount = Number(p.amount) || 0;
          return refunded > 0 && refunded >= amount;
        });
      }

      return filtered;
    },
  });

  // Stats query
  const { data: stats } = useQuery({
    queryKey: ["refunds-v2-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments_v2")
        .select("id, amount, refunded_amount, refunds")
        .eq("provider", "bepaid")
        .gt("refunded_amount", 0);

      if (error) throw error;

      const total = data?.length || 0;
      const partial = data?.filter(p => {
        const refunded = Number(p.refunded_amount) || 0;
        const amount = Number(p.amount) || 0;
        return refunded > 0 && refunded < amount;
      }).length || 0;
      const full = data?.filter(p => {
        const refunded = Number(p.refunded_amount) || 0;
        const amount = Number(p.amount) || 0;
        return refunded > 0 && refunded >= amount;
      }).length || 0;
      const totalRefunded = data?.reduce((sum, p) => sum + (Number(p.refunded_amount) || 0), 0) || 0;

      return { total, partial, full, totalRefunded };
    },
  });

  // Sync from bePaid mutation
  const syncMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase.functions.invoke('bepaid-get-payment-docs', {
        body: { order_id: orderId, force_refresh: true },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data?.status === 'success') {
        toast.success('Данные синхронизированы из bePaid');
      } else {
        toast.info(data?.message || 'Синхронизация завершена');
      }
      queryClient.invalidateQueries({ queryKey: ['refunds-v2'] });
    },
    onError: (error: any) => {
      toast.error('Ошибка синхронизации: ' + error.message);
    },
  });

  // Recompute status mutation
  const recomputeMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase.functions.invoke('refunds-recompute-order-status', {
        body: { order_id: orderId, dry_run: false },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data?.status === 'success') {
        const result = data.result;
        if (result.status_changed) {
          toast.success(`Статус заказа изменён на "${result.new_order_status}"`);
        } else {
          toast.success(`Статус возврата: ${result.refund_status}`);
        }
      } else {
        toast.info(data?.message || 'Пересчёт завершен');
      }
      queryClient.invalidateQueries({ queryKey: ['refunds-v2'] });
    },
    onError: (error: any) => {
      toast.error('Ошибка пересчёта: ' + error.message);
    },
  });

  // Batch sync mutation
  const batchSyncMutation = useMutation({
    mutationFn: async (orderIds: string[]) => {
      const results = [];
      for (const orderId of orderIds) {
        try {
          const { data, error } = await supabase.functions.invoke('bepaid-get-payment-docs', {
            body: { order_id: orderId, force_refresh: true },
          });
          results.push({ orderId, success: !error, data });
          // Rate limit delay
          await new Promise(r => setTimeout(r, 150));
        } catch (e) {
          results.push({ orderId, success: false, error: e });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const successCount = results.filter(r => r.success).length;
      toast.success(`Синхронизировано ${successCount} из ${results.length}`);
      setSelectedIds([]);
      queryClient.invalidateQueries({ queryKey: ['refunds-v2'] });
    },
  });

  // Filter by search
  const filteredPayments = payments?.filter((payment) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const order = payment.orders_v2 as any;
    const profile = payment.profiles as any;
    return (
      order?.order_number?.toLowerCase().includes(query) ||
      order?.customer_email?.toLowerCase().includes(query) ||
      profile?.email?.toLowerCase().includes(query) ||
      profile?.full_name?.toLowerCase().includes(query) ||
      payment.provider_payment_id?.toLowerCase().includes(query)
    );
  });

  const getRefundStatus = (payment: any): 'none' | 'partial' | 'full' => {
    const refunded = Number(payment.refunded_amount) || 0;
    const amount = Number(payment.amount) || 0;
    if (refunded <= 0) return 'none';
    if (refunded >= amount) return 'full';
    return 'partial';
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredPayments?.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredPayments?.map(p => (p.orders_v2 as any)?.id).filter(Boolean) || []);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Undo2 className="h-6 w-6" />
              Возвраты bePaid
            </h1>
            <p className="text-muted-foreground">Управление возвратами и синхронизация с bePaid</p>
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.length > 0 && (
              <Button 
                variant="outline" 
                onClick={() => batchSyncMutation.mutate(selectedIds)}
                disabled={batchSyncMutation.isPending}
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", batchSyncMutation.isPending && "animate-spin")} />
                Sync выбранных ({selectedIds.length})
              </Button>
            )}
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Обновить
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Платежей с возвратами
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Частичный возврат
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{stats?.partial || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Полный возврат
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats?.full || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Сумма возвратов
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {new Intl.NumberFormat("ru-BY", { style: "currency", currency: "BYN" }).format(stats?.totalRefunded || 0)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по номеру заказа, email, UID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={refundFilter} onValueChange={setRefundFilter}>
            <SelectTrigger className="w-[200px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Фильтр" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все bePaid платежи</SelectItem>
              <SelectItem value="has_refunds">Есть возвраты</SelectItem>
              <SelectItem value="partial">Частичный возврат</SelectItem>
              <SelectItem value="full">Полный возврат</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
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
                <Undo2 className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>Нет платежей с возвратами</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={selectedIds.length === filteredPayments.length && filteredPayments.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Заказ</TableHead>
                    <TableHead>Клиент</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead className="text-right">Возвращено</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Возвраты</TableHead>
                    <TableHead>Дата</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPayments.map((payment) => {
                    const order = payment.orders_v2 as any;
                    const profile = payment.profiles as any;
                    const refundStatus = getRefundStatus(payment);
                    const statusConfig = REFUND_STATUS_CONFIG[refundStatus];
                    const refunds = (payment.refunds || []) as any[];
                    const orderId = order?.id;

                    return (
                      <TableRow key={payment.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.includes(orderId)}
                            onCheckedChange={() => orderId && toggleSelect(orderId)}
                            disabled={!orderId}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-sm">{order?.order_number || "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {order?.status === 'refunded' ? (
                              <Badge variant="destructive" className="text-xs">Возврат</Badge>
                            ) : order?.status === 'paid' ? (
                              <Badge variant="default" className="text-xs">Оплачен</Badge>
                            ) : (
                              order?.status
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium truncate max-w-[150px]">
                            {profile?.full_name || order?.customer_email || "—"}
                          </div>
                          <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                            {profile?.email || ""}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {new Intl.NumberFormat("ru-BY", {
                            style: "currency",
                            currency: payment.currency || "BYN",
                          }).format(Number(payment.amount))}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={statusConfig.color}>
                            {new Intl.NumberFormat("ru-BY", {
                              style: "currency",
                              currency: payment.currency || "BYN",
                            }).format(Number(payment.refunded_amount) || 0)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                        </TableCell>
                        <TableCell>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1 cursor-default">
                                  <span className="font-medium">{refunds.length}</span>
                                  {refunds.length > 0 && (
                                    <span className="text-xs text-muted-foreground">
                                      ({refunds.filter(r => r.status === 'succeeded').length} успешных)
                                    </span>
                                  )}
                                </div>
                              </TooltipTrigger>
                              {refunds.length > 0 && (
                                <TooltipContent className="max-w-xs">
                                  <div className="space-y-1">
                                    {refunds.slice(0, 5).map((r: any, i: number) => (
                                      <div key={i} className="flex justify-between gap-4 text-xs">
                                        <span>{r.amount?.toFixed(2)} {r.currency || 'BYN'}</span>
                                        <span className={r.status === 'succeeded' ? 'text-green-500' : 'text-muted-foreground'}>
                                          {r.status}
                                        </span>
                                      </div>
                                    ))}
                                    {refunds.length > 5 && (
                                      <div className="text-xs text-muted-foreground">+{refunds.length - 5} ещё</div>
                                    )}
                                  </div>
                                </TooltipContent>
                              )}
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {format(new Date(payment.created_at), "dd.MM.yy", { locale: ru })}
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
                              <DropdownMenuItem
                                onClick={() => orderId && syncMutation.mutate(orderId)}
                                disabled={syncMutation.isPending}
                              >
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Sync из bePaid
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => orderId && recomputeMutation.mutate(orderId)}
                                disabled={recomputeMutation.isPending}
                              >
                                <Calculator className="h-4 w-4 mr-2" />
                                Пересчитать статус
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {payment.receipt_url && (
                                <DropdownMenuItem asChild>
                                  <a href={payment.receipt_url} target="_blank" rel="noopener noreferrer">
                                    <Receipt className="h-4 w-4 mr-2" />
                                    Чек платежа
                                  </a>
                                </DropdownMenuItem>
                              )}
                              {refunds.some((r: any) => r.receipt_url) && (
                                <DropdownMenuItem asChild>
                                  <a 
                                    href={refunds.find((r: any) => r.receipt_url)?.receipt_url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                  >
                                    <Receipt className="h-4 w-4 mr-2" />
                                    Чек возврата
                                  </a>
                                </DropdownMenuItem>
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
