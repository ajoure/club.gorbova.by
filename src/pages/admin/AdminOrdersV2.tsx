import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
  XCircle,
  ExternalLink,
  BookOpen,
  AlertTriangle,
  Send,
  Receipt,
  Undo2,
  Download,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [gcFilter, setGcFilter] = useState<string>("all");
  const [receiptFilter, setReceiptFilter] = useState<string>("all");
  const [gcPendingOrderId, setGcPendingOrderId] = useState<string | null>(null);
  const [fetchingDocsOrderId, setFetchingDocsOrderId] = useState<string | null>(null);
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

  // Mutation for GC retry
  const gcRetryMutation = useMutation({
    mutationFn: async (orderId: string) => {
      setGcPendingOrderId(orderId);
      const { data, error } = await supabase.functions.invoke('getcourse-grant-access', {
        body: { order_id: orderId, force: true },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data?.status === 'success') {
        toast.success('Отправлено в GetCourse');
      } else if (data?.status === 'skipped') {
        toast.warning(`Пропущено: ${data.skipped_reason || data.error}`);
      } else {
        toast.error(data?.error || 'Ошибка синхронизации');
      }
      queryClient.invalidateQueries({ queryKey: ['orders-v2'] });
      refetch();
    },
    onSettled: () => {
      setGcPendingOrderId(null);
    },
    onError: (error: any) => {
      toast.error('Ошибка GC sync', { description: error.message });
    },
  });

  // Mutation for fetching bePaid docs
  const fetchBepaidDocsMutation = useMutation({
    mutationFn: async (orderId: string) => {
      setFetchingDocsOrderId(orderId);
      const { data, error } = await supabase.functions.invoke('bepaid-get-payment-docs', {
        body: { order_id: orderId, force_refresh: false },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data?.status === 'success') {
        toast.success('Чек получен');
      } else if (data?.status === 'skipped') {
        toast.info('Чек уже загружен');
      } else {
        toast.error(data?.error || 'Ошибка');
      }
      queryClient.invalidateQueries({ queryKey: ['orders-v2'] });
      refetch();
    },
    onSettled: () => {
      setFetchingDocsOrderId(null);
    },
    onError: (error: any) => {
      toast.error('Ошибка: ' + error.message);
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
          flows(id, name, code),
          payments_v2(id, provider, provider_payment_id, receipt_url, refunded_amount, refunds, amount, status, meta)
        `)
        .order("created_at", { ascending: false })
        .limit(100);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter as "draft" | "pending" | "paid" | "partial" | "canceled" | "refunded" | "failed");
      }

      const { data, error } = await query;
      if (error) throw error;
      
      // Fetch profiles for user_ids
      const userIds = data?.map(o => o.user_id).filter(Boolean) as string[] || [];
      if (userIds.length === 0) return data?.map(o => ({ ...o, profile: null })) || [];
      
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);
      
      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
      
      return data?.map(o => ({
        ...o,
        profile: o.user_id ? profileMap.get(o.user_id) || null : null,
      })) || [];
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
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const profile = (order as any).profile;
      const matchesSearch = (
        order.order_number?.toLowerCase().includes(query) ||
        order.customer_email?.toLowerCase().includes(query) ||
        order.customer_phone?.includes(query) ||
        profile?.full_name?.toLowerCase().includes(query) ||
        order.products_v2?.name?.toLowerCase().includes(query)
      );
      if (!matchesSearch) return false;
    }
    
    // GC filter
    if (gcFilter !== "all") {
      const meta = (order.meta as any) ?? {};
      const gcStatus = meta.gc_sync_status ?? null;
      const gcErrorType = meta.gc_sync_error_type ?? null;
      const gcNextRetryAt = order.gc_next_retry_at;
      
      if (gcFilter === "success" && gcStatus !== "success") return false;
      if (gcFilter === "failed" && gcStatus !== "failed") return false;
      if (gcFilter === "skipped" && gcStatus !== "skipped") return false;
      if (gcFilter === "not_sent" && !!gcStatus) return false;
      if (gcFilter === "rate_limit") {
        if (gcErrorType !== "rate_limit") return false;
      }
      if (gcFilter === "retry_ready") {
        if (gcErrorType !== "rate_limit") return false;
        if (!gcNextRetryAt || new Date(gcNextRetryAt) > new Date()) return false;
      }
    }
    
    // Receipt filter - only for bePaid succeeded payments
    if (receiptFilter !== "all") {
      const bepaidPayment = ((order as any).payments_v2 || []).find((p: any) => 
        p.provider === 'bepaid' && p.status === 'succeeded' && p.provider_payment_id
      );
      
      if (receiptFilter === "has_receipt") {
        if (!bepaidPayment?.receipt_url) return false;
      }
      if (receiptFilter === "no_receipt") {
        // Must have a bePaid succeeded payment without receipt
        if (!bepaidPayment) return false;
        if (bepaidPayment.receipt_url) return false;
      }
    }
    
    return true;
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
          <Select value={gcFilter} onValueChange={setGcFilter}>
            <SelectTrigger className="w-[180px]">
              <BookOpen className="h-4 w-4 mr-2" />
              <SelectValue placeholder="GC статус" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все GC</SelectItem>
              <SelectItem value="success">✅ Синхронизировано</SelectItem>
              <SelectItem value="failed">❌ Ошибка</SelectItem>
              <SelectItem value="skipped">⏭️ Пропущено</SelectItem>
              <SelectItem value="not_sent">📤 Не отправлено</SelectItem>
              <SelectItem value="rate_limit">⏳ Rate limit</SelectItem>
              <SelectItem value="retry_ready">🔄 Готов к retry</SelectItem>
            </SelectContent>
          </Select>
          <Select value={receiptFilter} onValueChange={setReceiptFilter}>
            <SelectTrigger className="w-[150px]">
              <Receipt className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Чек" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="has_receipt">Есть чек</SelectItem>
              <SelectItem value="no_receipt">Нет чека</SelectItem>
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
                    <TableHead>Чек</TableHead>
                    <TableHead>Возврат</TableHead>
                    <TableHead>GC</TableHead>
                    <TableHead>Дата</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.map((order) => {
                    const statusConfig = ORDER_STATUS_LABELS[order.status] || { label: order.status, variant: "secondary" as const };
                    const profile = (order as any).profile;
                    // Phase 8-C: accept both bePaid and Stripe acquiring payments for the
                    // Receipt column. Stripe receipt_url is materialized into payments_v2
                    // by stripe-webhook; hosted_invoice_url / invoice_pdf live in meta.stripe.
                    const bepaidPayment = ((order as any).payments_v2 || []).find((p: any) =>
                      (p.provider === 'bepaid' || p.provider === 'stripe') && p.status === 'succeeded'
                    );
                    const stripeHosted = bepaidPayment?.meta?.stripe?.hosted_invoice_url || null;
                    const stripeInvoicePdf = bepaidPayment?.meta?.stripe?.invoice_pdf || null;
                    const refundedAmount = bepaidPayment ? Number(bepaidPayment.refunded_amount) || 0 : 0;
                    const paymentAmount = bepaidPayment ? Number(bepaidPayment.amount) || 0 : 0;
                    const refundStatus = refundedAmount >= paymentAmount && refundedAmount > 0 ? 'full' : refundedAmount > 0 ? 'partial' : 'none';
                    
                    return (
                      <TableRow key={order.id}>
                        <TableCell>
                          <div className="font-mono text-sm">{order.order_number}</div>
                          {order.is_trial && (
                            <Badge variant="outline" className="text-xs mt-1">Trial</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {profile ? (
                            <div>
                              <button
                                onClick={() => navigate(`/admin/contacts?contact=${order.user_id}&from=orders`)}
                                className="font-medium text-left hover:text-primary hover:underline transition-colors cursor-pointer"
                              >
                                {profile.full_name || order.customer_email || "—"}
                              </button>
                              <div className="text-xs text-muted-foreground">{profile.email || order.customer_phone}</div>
                            </div>
                          ) : (
                            <div>
                              <div className="font-medium">
                                {order.customer_email || "—"}
                              </div>
                              {order.customer_phone && (
                                <div className="text-xs text-muted-foreground">{order.customer_phone}</div>
                              )}
                            </div>
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
                        {/* Receipt column */}
                        <TableCell>
                          {bepaidPayment?.receipt_url ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <a 
                                    href={bepaidPayment.receipt_url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent"
                                  >
                                    <Receipt className="h-4 w-4 text-green-600" />
                                  </a>
                                </TooltipTrigger>
                                <TooltipContent>Открыть чек</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : stripeHosted || stripeInvoicePdf ? (
                            // Phase 8-C: Stripe subscription invoice links.
                            <div className="flex items-center gap-1">
                              {stripeHosted && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <a
                                        href={stripeHosted}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent"
                                      >
                                        <Receipt className="h-4 w-4 text-blue-600" />
                                      </a>
                                    </TooltipTrigger>
                                    <TooltipContent>Stripe-инвойс (онлайн)</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                              {stripeInvoicePdf && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <a
                                        href={stripeInvoicePdf}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent"
                                      >
                                        <Download className="h-4 w-4 text-blue-600" />
                                      </a>
                                    </TooltipTrigger>
                                    <TooltipContent>Stripe-инвойс (PDF)</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                          ) : bepaidPayment?.provider === 'bepaid' && bepaidPayment?.provider_payment_id ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    className="h-8 w-8"
                                    disabled={fetchingDocsOrderId === order.id}
                                    onClick={() => fetchBepaidDocsMutation.mutate(order.id)}
                                  >
                                    {fetchingDocsOrderId === order.id ? (
                                      <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Download className="h-4 w-4 text-muted-foreground" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Получить чек</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        {/* Refund indicator */}
                        <TableCell>
                          {refundStatus === 'full' ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <Badge variant="destructive">Полный</Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Возвращено: {new Intl.NumberFormat("ru-BY", { style: "currency", currency: "BYN" }).format(refundedAmount)}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : refundStatus === 'partial' ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <Badge variant="outline" className="text-orange-600 border-orange-600">Частичный</Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Возвращено: {new Intl.NumberFormat("ru-BY", { style: "currency", currency: "BYN" }).format(refundedAmount)} из {new Intl.NumberFormat("ru-BY", { style: "currency", currency: "BYN" }).format(paymentAmount)}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <TooltipProvider>
                            {(order.meta as any)?.gc_sync_status === 'success' ? (
                              <Tooltip>
                                <TooltipTrigger>
                                  <CheckCircle className="h-4 w-4 text-green-600" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Синхронизировано в GetCourse</p>
                                  {(order.meta as any)?.gc_order_id && (
                                    <p className="text-xs text-muted-foreground">ID: {(order.meta as any).gc_order_id}</p>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            ) : (order.meta as any)?.gc_sync_status === 'failed' ? (
                              <Tooltip>
                                <TooltipTrigger>
                                  <XCircle className="h-4 w-4 text-destructive" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Ошибка синхронизации</p>
                                  {(order.meta as any)?.gc_sync_error && (
                                    <p className="text-xs text-destructive">{(order.meta as any).gc_sync_error}</p>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            ) : (order.meta as any)?.gc_sync_status === 'skipped' ? (
                              <Tooltip>
                                <TooltipTrigger>
                                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Пропущено</p>
                                  {(order.meta as any)?.gc_sync_error && (
                                    <p className="text-xs text-muted-foreground">{(order.meta as any).gc_sync_error}</p>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TooltipProvider>
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
                              {/* GC retry option */}
                              {order.status === 'paid' && (order.meta as any)?.gc_sync_status !== 'success' && (() => {
                                const isPendingThis = gcPendingOrderId === order.id && gcRetryMutation.isPending;
                                return (
                                  <DropdownMenuItem 
                                    onClick={() => gcRetryMutation.mutate(order.id)}
                                    disabled={isPendingThis}
                                    className="text-blue-600"
                                  >
                                    <Send className="h-4 w-4 mr-2" />
                                    {isPendingThis ? 'Отправка...' : 'Отправить в GetCourse'}
                                  </DropdownMenuItem>
                                );
                              })()}
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
