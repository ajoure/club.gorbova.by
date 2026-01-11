import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  RefreshCw, Download, CheckCircle2, User, CreditCard, Mail, 
  AlertCircle, Clock, Database, Phone, Package, ExternalLink, AlertTriangle
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useBepaidQueue, useBepaidPayments, useBepaidStats, QueueItem, PaymentItem } from "@/hooks/useBepaidData";

export default function AdminBepaidSync() {
  const [activeMainTab, setActiveMainTab] = useState("payments");
  const [selectedQueueItems, setSelectedQueueItems] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const { payments, paymentsLoading, refetchPayments } = useBepaidPayments();
  const { queueItems, queueLoading, refetchQueue } = useBepaidQueue();
  const stats = useBepaidStats();

  const refreshAll = () => {
    refetchPayments();
    refetchQueue();
    queryClient.invalidateQueries({ queryKey: ["bepaid-stats"] });
    toast.success("Данные обновлены");
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

  return (
    <TooltipProvider>
      <div className="container mx-auto p-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">Синхронизация bePaid</h1>
            <p className="text-muted-foreground">
              Платежи из bePaid и очередь на обработку
            </p>
          </div>
          <Button onClick={refreshAll} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Обновить
          </Button>
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
          <TabsList className="mb-4">
            <TabsTrigger value="payments" className="gap-2">
              <Database className="h-4 w-4" />
              Платежи в системе ({payments.length})
            </TabsTrigger>
            <TabsTrigger value="queue" className="gap-2">
              <Clock className="h-4 w-4" />
              Очередь ({queueItems.length})
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
                  <ScrollArea className="h-[500px]">
                    <Table>
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
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-1 max-w-[150px]">
                                    <Package className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate">{payment.product_name || "—"}</span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>{payment.product_name || "Не указан"}</TooltipContent>
                              </Tooltip>
                              {payment.order_number && (
                                <div className="text-xs text-muted-foreground">{payment.order_number}</div>
                              )}
                            </TableCell>
                            <TableCell>
                              <span className="font-medium">{payment.profile_name || "—"}</span>
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
                  </ScrollArea>
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
                    <Button variant="outline" onClick={exportQueue} disabled={queueItems.length === 0}>
                      <Download className="h-4 w-4 mr-2" />
                      Экспорт CSV
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {queueLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : queueItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Очередь пуста
                  </div>
                ) : (
                  <ScrollArea className="h-[500px]">
                    <Table>
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
                              {item.amount ? `${item.amount / 100} ${item.currency}` : "—"}
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
                                <div className="flex flex-col gap-1">
                                  <span className="font-medium text-green-600">{item.matched_profile_name}</span>
                                  {item.matched_profile_phone && (
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                      <Phone className="h-3 w-3" />
                                      {item.matched_profile_phone}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">Не найден</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
