import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  RefreshCw, Download, CheckCircle2, User, CreditCard, Mail, 
  AlertCircle, Clock, Database, Phone, Package, AlertTriangle, Link2, Calendar, Eye, Edit, FileText,
  BarChart3, ArrowRightLeft, Upload, Play, ArrowLeft
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useBepaidQueue, useBepaidPayments, useBepaidStats, QueueItem, PaymentItem, DateFilter } from "@/hooks/useBepaidData";
import BepaidMappingsTab from "@/components/admin/bepaid/BepaidMappingsTab";
import BepaidAnalyticsTab from "@/components/admin/bepaid/BepaidAnalyticsTab";
import BepaidReconciliationTab from "@/components/admin/bepaid/BepaidReconciliationTab";
import BepaidImportDialog from "@/components/admin/bepaid/BepaidImportDialog";
import { CreateOrderButton, LinkToProfileButton } from "@/components/admin/bepaid/BepaidQueueActions";
import BulkProcessBar from "@/components/admin/bepaid/BulkProcessBar";
import ContactDealsDialog from "@/components/admin/bepaid/ContactDealsDialog";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
import { DealDetailSheet } from "@/components/admin/DealDetailSheet";

export default function AdminBepaidSync() {
  const navigate = useNavigate();
  const [activeMainTab, setActiveMainTab] = useState("payments");
  const [selectedQueueItems, setSelectedQueueItems] = useState<Set<string>>(new Set());
  
  // Date filter - default from 2026-01-01
  const [dateFilter, setDateFilter] = useState<DateFilter>({
    from: "2026-01-01",
    to: undefined,
  });
  
  // Contact deals dialog state
  const [dealsDialogOpen, setDealsDialogOpen] = useState(false);
  const [selectedContactForDeals, setSelectedContactForDeals] = useState<any>(null);
  
  // Contact detail sheet state
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  
  // Deal detail sheet state (for payments tab)
  const [dealSheetOpen, setDealSheetOpen] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<any>(null);
  
  // Import dialog state
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  
  // Process queue state
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  
  // Refresh from bePaid API state
  const [isRefreshingFromApi, setIsRefreshingFromApi] = useState(false);
  
  const queryClient = useQueryClient();

  const { payments, paymentsLoading, refetchPayments } = useBepaidPayments(dateFilter);
  const { queueItems, queueLoading, refetchQueue, linkProfileManually } = useBepaidQueue(dateFilter);
  const stats = useBepaidStats(dateFilter);
  
  const handleOpenContactDeals = (item: QueueItem) => {
    if (item.matched_profile_id) {
      setSelectedContactForDeals({
        id: item.matched_profile_id,
        full_name: item.matched_profile_name,
        phone: item.matched_profile_phone,
        email: item.customer_email,
      });
      setDealsDialogOpen(true);
    }
  };
  
  const handleOpenContact = async (item: QueueItem) => {
    if (item.matched_profile_id) {
      // Fetch full profile data from DB to get correct email and user_id
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, phone, email, created_at, telegram_user_id, telegram_username, avatar_url, status")
        .eq("id", item.matched_profile_id)
        .single();
      
      if (profile) {
        setSelectedContact({
          id: profile.id,
          user_id: profile.user_id, // Use actual user_id for deals lookup
          full_name: profile.full_name,
          phone: profile.phone,
          email: profile.email,
          created_at: profile.created_at,
          telegram_user_id: profile.telegram_user_id,
          telegram_username: profile.telegram_username,
          avatar_url: profile.avatar_url,
          status: profile.status || 'active',
        });
        setContactSheetOpen(true);
      }
    }
  };

  // Simple refresh for local data only
  const refreshLocalData = () => {
    refetchPayments();
    refetchQueue();
    queryClient.invalidateQueries({ queryKey: ["bepaid-stats"] });
  };

  // Fetch new transactions from bePaid API
  const handleRefreshFromBepaidApi = async () => {
    setIsRefreshingFromApi(true);
    try {
      const { data, error } = await supabase.functions.invoke('bepaid-fetch-transactions');
      if (error) throw error;
      
      const result = data as { 
        transactions_fetched?: number; 
        queued_for_review?: number;
        new_payments?: number;
        error?: string;
      };
      
      if (result.error) {
        toast.error(`Ошибка: ${result.error}`);
      } else {
        toast.success(
          `Загружено ${result.transactions_fetched || 0} транзакций, ` +
          `${result.queued_for_review || 0} добавлено в очередь`
        );
        refetchPayments();
        refetchQueue();
        queryClient.invalidateQueries({ queryKey: ["bepaid-stats"] });
      }
    } catch (e: any) {
      console.error('Error refreshing from bePaid:', e);
      toast.error('Ошибка обновления: ' + (e.message || 'Неизвестная ошибка'));
    } finally {
      setIsRefreshingFromApi(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
      succeeded: { variant: "default", label: "Успешно" },
      successful: { variant: "default", label: "Успешно" },
      pending: { variant: "outline", label: "Ожидает" },
      processing: { variant: "secondary", label: "Обработка" },
      failed: { variant: "destructive", label: "Ошибка" },
      error: { variant: "destructive", label: "Ошибка" },
    };
    const config = variants[status] || { variant: "outline" as const, label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getMatchTypeBadge = (matchType: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string; icon: React.ReactNode }> = {
      email: { variant: "default", label: "Email", icon: <Mail className="h-3 w-3 mr-1" /> },
      name: { variant: "secondary", label: "Имя", icon: <User className="h-3 w-3 mr-1" /> },
      manual: { variant: "default", label: "Вручную", icon: <User className="h-3 w-3 mr-1" /> },
      none: { variant: "outline", label: "Нет", icon: <AlertCircle className="h-3 w-3 mr-1" /> },
    };
    const config = variants[matchType] || variants.none;
    return (
      <Badge variant={config.variant} className="flex items-center">
        {config.icon}
        {config.label}
      </Badge>
    );
  };

  const exportPayments = () => {
    const csv = [
      ["ID", "Дата", "Сумма", "Валюта", "Статус", "Карта", "Владелец карты", "Заказ", "Продукт", "Клиент", "Email", "Телефон"].join(";"),
      ...payments.map(p => [
        p.id,
        p.created_at ? format(new Date(p.created_at), "dd.MM.yyyy HH:mm", { locale: ru }) : "",
        p.amount,
        p.currency,
        p.status,
        p.card_last4 ? `*${p.card_last4}` : "",
        p.card_holder || "",
        p.order_number || "",
        p.product_name || "",
        p.profile_name || "",
        p.profile_email || "",
        p.profile_phone || "",
      ].join(";"))
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bepaid-payments-${format(new Date(), "yyyy-MM-dd-HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV экспортирован");
  };

  const exportQueue = () => {
    const csv = [
      ["ID", "Дата", "Сумма", "Валюта", "Статус", "Ошибка", "Карта", "Владелец карты", "Продукт", "Email", "Сопоставление", "Клиент", "Телефон клиента"].join(";"),
      ...queueItems.map(q => [
        q.id,
        q.created_at ? format(new Date(q.created_at), "dd.MM.yyyy HH:mm", { locale: ru }) : "",
        q.amount || "",
        q.currency,
        q.status,
        q.last_error || "",
        q.card_last4 ? `*${q.card_last4}` : "",
        q.card_holder || "",
        q.product_name || "",
        q.customer_email || "",
        q.match_type,
        q.matched_profile_name || "",
        q.matched_profile_phone || "",
      ].join(";"))
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bepaid-queue-${format(new Date(), "yyyy-MM-dd-HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV экспортирован");
  };

  const toggleQueueSelectAll = () => {
    if (selectedQueueItems.size === queueItems.length) {
      setSelectedQueueItems(new Set());
    } else {
      setSelectedQueueItems(new Set(queueItems.map(q => q.id)));
    }
  };

  const toggleQueueItem = (id: string) => {
    const newSet = new Set(selectedQueueItems);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedQueueItems(newSet);
  };

  const handleLinkProfile = (item: QueueItem, profile: { id: string; full_name: string | null; phone: string | null; email?: string | null }) => {
    linkProfileManually(item.id, profile, item);
  };

  return (
    <TooltipProvider>
      <div className="container mx-auto p-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Синхронизация bePaid</h1>
              <p className="text-muted-foreground">
                Платежи из bePaid и очередь на обработку
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Refresh from API button */}
            <Button 
              variant="outline" 
              onClick={handleRefreshFromBepaidApi} 
              disabled={isRefreshingFromApi}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshingFromApi ? 'animate-spin' : ''}`} />
              Обновить из bePaid
            </Button>
            
            {/* Import button - prominent in header */}
            <Button onClick={() => setImportDialogOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" />
              Импорт CSV/Excel
            </Button>
            
            {/* Date filter */}
            <div className="flex items-center gap-2 bg-muted/50 p-2 rounded-lg">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div className="flex items-center gap-2">
                <Label htmlFor="date-from" className="text-sm text-muted-foreground whitespace-nowrap">С:</Label>
                <Input
                  id="date-from"
                  type="date"
                  value={dateFilter.from}
                  onChange={(e) => setDateFilter(prev => ({ ...prev, from: e.target.value }))}
                  className="h-8 w-36"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="date-to" className="text-sm text-muted-foreground whitespace-nowrap">По:</Label>
                <Input
                  id="date-to"
                  type="date"
                  value={dateFilter.to || ""}
                  onChange={(e) => setDateFilter(prev => ({ ...prev, to: e.target.value || undefined }))}
                  className="h-8 w-36"
                  placeholder="Сегодня"
                />
              </div>
            </div>
          </div>
        </div>
        
        {/* API limitation notice */}
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-200">API bePaid ограничен</p>
            <p className="text-amber-700 dark:text-amber-300 mt-1">
              Для загрузки всех платежей скачайте выписку из личного кабинета bePaid (CSV/Excel) и используйте кнопку "Импорт из bePaid".
              Новые платежи будут поступать автоматически через webhook.
            </p>
          </div>
        </div>

        {/* Stats cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Database className="h-4 w-4 text-primary" />
                Платежи в системе
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.paymentsCount}</div>
              <p className="text-xs text-muted-foreground">Обработанные платежи bePaid</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                В очереди
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.queueTotal}</div>
              <p className="text-xs text-muted-foreground">
                Ожидает: {stats.queuePending} | Обработка: {stats.queueProcessing}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Ошибки в очереди
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{stats.queueErrors}</div>
              <p className="text-xs text-muted-foreground">Записи с ошибками</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Сопоставлено
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {queueItems.filter(q => q.match_type !== 'none').length}
              </div>
              <p className="text-xs text-muted-foreground">Из очереди с найденным контактом</p>
            </CardContent>
          </Card>
        </div>

        {/* Main tabs */}
        <Tabs value={activeMainTab} onValueChange={setActiveMainTab}>
          <TabsList className="mb-4 flex-wrap h-auto gap-1">
            <TabsTrigger value="payments" className="gap-2">
              <Database className="h-4 w-4" />
              Платежи ({payments.length})
            </TabsTrigger>
            <TabsTrigger value="queue" className="gap-2">
              <Clock className="h-4 w-4" />
              Очередь ({queueItems.length})
            </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Аналитика
            </TabsTrigger>
            <TabsTrigger value="reconciliation" className="gap-2">
              <ArrowRightLeft className="h-4 w-4" />
              Сверка
            </TabsTrigger>
            <TabsTrigger value="mappings" className="gap-2">
              <Link2 className="h-4 w-4" />
              Маппинг
            </TabsTrigger>
          </TabsList>

          {/* Payments tab */}
          <TabsContent value="payments">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <CardTitle>Платежи bePaid в системе</CardTitle>
                    <CardDescription>
                      Обработанные платежи, сохранённые в базе данных
                    </CardDescription>
                  </div>
                  <Button variant="outline" onClick={exportPayments} disabled={payments.length === 0}>
                    <Download className="h-4 w-4 mr-2" />
                    Экспорт CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {paymentsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : payments.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Нет платежей bePaid в системе
                  </div>
                ) : (
                  <div className="max-h-[500px] overflow-auto -webkit-overflow-scrolling-touch">
                    <Table className="min-w-[900px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Дата</TableHead>
                          <TableHead className="text-right">Сумма</TableHead>
                          <TableHead>Статус</TableHead>
                          <TableHead>Карта</TableHead>
                          <TableHead>Продукт</TableHead>
                          <TableHead>Клиент</TableHead>
                          <TableHead>Контакты</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payments.map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell className="whitespace-nowrap">
                              {payment.created_at && format(new Date(payment.created_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {payment.amount} {payment.currency}
                            </TableCell>
                            <TableCell>
                              {getStatusBadge(payment.status)}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                {payment.card_last4 && (
                                  <div className="flex items-center gap-1 text-sm">
                                    <CreditCard className="h-3 w-3" />
                                    <span>*{payment.card_last4}</span>
                                    {payment.card_brand && (
                                      <Badge variant="outline" className="text-xs">{payment.card_brand}</Badge>
                                    )}
                                  </div>
                                )}
                                {payment.card_holder && (
                                  <span className="text-xs text-muted-foreground">{payment.card_holder}</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {payment.order_id ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-auto p-1 flex flex-col items-start gap-0.5"
                                  onClick={async () => {
                                    const { data: order } = await supabase
                                      .from("orders_v2")
                                      .select("*")
                                      .eq("id", payment.order_id)
                                      .single();
                                    if (order) {
                                      setSelectedDeal(order);
                                      setDealSheetOpen(true);
                                    }
                                  }}
                                >
                                  <div className="flex items-center gap-1">
                                    <Package className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate max-w-[120px]">{payment.product_name || "—"}</span>
                                  </div>
                                  {payment.order_number && (
                                    <span className="text-xs text-muted-foreground">{payment.order_number}</span>
                                  )}
                                </Button>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {payment.user_id ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-auto p-1 font-medium text-primary hover:underline"
                                  onClick={() => {
                                    setSelectedContact({
                                      id: payment.user_id,
                                      user_id: payment.user_id,
                                      full_name: payment.profile_name,
                                      phone: payment.profile_phone,
                                      email: payment.profile_email,
                                    });
                                    setContactSheetOpen(true);
                                  }}
                                >
                                  {payment.profile_name || "—"}
                                </Button>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1 text-sm">
                                {payment.profile_email && (
                                  <div className="flex items-center gap-1">
                                    <Mail className="h-3 w-3 text-muted-foreground" />
                                    <span className="truncate max-w-[150px]">{payment.profile_email}</span>
                                  </div>
                                )}
                                {payment.profile_phone && (
                                  <div className="flex items-center gap-1">
                                    <Phone className="h-3 w-3 text-muted-foreground" />
                                    <span>{payment.profile_phone}</span>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Queue tab */}
          <TabsContent value="queue">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <CardTitle>Очередь на обработку</CardTitle>
                    <CardDescription>
                      Платежи из webhook, ожидающие обработки. Данные карты извлечены из raw_payload.
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
                      <Upload className="h-4 w-4 mr-2" />
                      Импорт CSV/Excel
                    </Button>
                    <Button variant="outline" onClick={exportQueue} disabled={queueItems.length === 0}>
                      <Download className="h-4 w-4 mr-2" />
                      Экспорт CSV
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Bulk actions bar */}
                {selectedQueueItems.size > 0 && (
                  <BulkProcessBar
                    selectedItems={queueItems.filter(q => selectedQueueItems.has(q.id))}
                    onSuccess={() => {
                      setSelectedQueueItems(new Set());
                      refetchQueue();
                      refetchPayments();
                    }}
                    onClearSelection={() => setSelectedQueueItems(new Set())}
                  />
                )}

                {queueLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : queueItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Очередь пуста
                  </div>
                ) : (
                  <div className="max-h-[500px] overflow-auto -webkit-overflow-scrolling-touch">
                    <Table className="min-w-[1000px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">
                            <Checkbox 
                              checked={selectedQueueItems.size === queueItems.length && queueItems.length > 0}
                              onCheckedChange={toggleQueueSelectAll}
                            />
                          </TableHead>
                          <TableHead>Дата</TableHead>
                          <TableHead className="text-right">Сумма</TableHead>
                          <TableHead>Статус</TableHead>
                          <TableHead>Карта</TableHead>
                          <TableHead>Продукт</TableHead>
                          <TableHead>Email bePaid</TableHead>
                          <TableHead>Сопоставление</TableHead>
                          <TableHead>Клиент в системе</TableHead>
                          <TableHead>Действия</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {queueItems.map((item) => (
                          <TableRow key={item.id} className={item.last_error ? "bg-destructive/5" : ""}>
                            <TableCell>
                              <Checkbox 
                                checked={selectedQueueItems.has(item.id)}
                                onCheckedChange={() => toggleQueueItem(item.id)}
                              />
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {item.created_at && format(new Date(item.created_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {item.amount ? `${item.amount} ${item.currency}` : "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                {getStatusBadge(item.status)}
                                {item.last_error && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge variant="destructive" className="text-xs cursor-help">
                                        {item.last_error.substring(0, 15)}...
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[300px]">
                                      {item.last_error}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                {item.card_last4 && (
                                  <div className="flex items-center gap-1 text-sm">
                                    <CreditCard className="h-3 w-3" />
                                    <span>*{item.card_last4}</span>
                                    {item.card_brand && (
                                      <Badge variant="outline" className="text-xs">{item.card_brand}</Badge>
                                    )}
                                  </div>
                                )}
                                {item.card_holder && (
                                  <span className="text-xs font-medium">{item.card_holder}</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-1 max-w-[150px]">
                                    <Package className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate">{item.product_name || "—"}</span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>{item.product_name || "Не указан"}</TooltipContent>
                              </Tooltip>
                              {item.event_type && (
                                <div className="text-xs text-muted-foreground">{item.event_type}</div>
                              )}
                            </TableCell>
                            <TableCell>
                              {item.customer_email ? (
                                <div className="flex items-center gap-1 text-sm">
                                  <Mail className="h-3 w-3 text-muted-foreground" />
                                  <span className="truncate max-w-[120px]">{item.customer_email}</span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {getMatchTypeBadge(item.match_type)}
                            </TableCell>
                            <TableCell>
                              {item.matched_profile_id ? (
                                <div className="flex items-center gap-2">
                                  <div 
                                    className="flex flex-col gap-1 cursor-pointer hover:bg-accent/50 p-1 rounded transition-colors"
                                    onClick={() => handleOpenContact(item)}
                                    title="Открыть карточку контакта"
                                  >
                                    <span className="font-medium text-green-600 hover:underline">{item.matched_profile_name}</span>
                                    {item.matched_profile_phone && (
                                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <Phone className="h-3 w-3" />
                                        {item.matched_profile_phone}
                                      </div>
                                    )}
                                    {item.match_type === 'manual' && (
                                      <Badge variant="outline" className="text-xs w-fit">Авто</Badge>
                                    )}
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleOpenContactDeals(item)}
                                    title="Открыть сделки"
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                </div>
                              ) : (
                                <LinkToProfileButton 
                                  item={item} 
                                  onSuccess={refetchQueue}
                                  onLinkProfile={(profile) => handleLinkProfile(item, profile)}
                                />
                              )}
                            </TableCell>
                            <TableCell>
                              <CreateOrderButton item={item} onSuccess={refetchQueue} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Analytics tab */}
          <TabsContent value="analytics">
            <BepaidAnalyticsTab dateFilter={dateFilter} />
          </TabsContent>

          {/* Reconciliation tab */}
          <TabsContent value="reconciliation">
            <BepaidReconciliationTab dateFilter={dateFilter} />
          </TabsContent>


          {/* Mappings tab */}
          <TabsContent value="mappings">
            <BepaidMappingsTab dateFilter={dateFilter} />
          </TabsContent>
        </Tabs>
        
        {/* Contact Deals Dialog */}
        <ContactDealsDialog
          open={dealsDialogOpen}
          onOpenChange={setDealsDialogOpen}
          profile={selectedContactForDeals}
          onDealUpdated={refetchQueue}
        />
        
        {/* Contact Detail Sheet */}
        <ContactDetailSheet
          open={contactSheetOpen}
          onOpenChange={(open) => {
            setContactSheetOpen(open);
            if (!open) {
              refetchQueue();
              refetchPayments();
            }
          }}
          contact={selectedContact}
        />
        
        {/* Deal Detail Sheet for payments */}
        <DealDetailSheet
          open={dealSheetOpen}
          onOpenChange={(open) => {
            setDealSheetOpen(open);
            if (!open) {
              refetchPayments();
            }
          }}
          deal={selectedDeal}
          profile={selectedDeal ? { id: selectedDeal.user_id, full_name: null, phone: null } : null}
        />
        
        {/* Import Dialog */}
        <BepaidImportDialog 
          open={importDialogOpen} 
          onOpenChange={setImportDialogOpen}
          onSuccess={() => {
            refetchQueue();
            refetchPayments();
          }}
        />
      </div>
    </TooltipProvider>
  );
}
