import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  RefreshCw, Download, CreditCard, Mail, Phone, User, 
  CheckCircle2, AlertCircle, FileText, ArrowRightLeft, Loader2,
  ExternalLink, Globe, Receipt, Package, UserCheck, Link2, 
  ShoppingCart, Repeat, UserPlus
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ClickableContactName } from "@/components/admin/ClickableContactName";
import { LinkTransactionDialog } from "./LinkTransactionDialog";

interface DateFilter {
  from: string;
  to?: string;
}

interface RawTransaction {
  uid: string;
  type: string;
  subscription_id?: string;
  status: string;
  amount: number | null;
  currency: string;
  description?: string;
  paid_at?: string;
  created_at?: string;
  _bepaid_time?: string;
  _bepaid_created_at?: string;
  _bepaid_paid_at?: string;
  receipt_url?: string;
  tracking_id?: string;
  message?: string;
  ip_address?: string;
  plan_title?: string;
  product_name?: string;
  tariff_name?: string;
  customer_email?: string;
  customer_name?: string;
  customer_phone?: string;
  card_last_4?: string;
  card_brand?: string;
  card_holder?: string;
  bank_code?: string;
  rrn?: string;
  auth_code?: string;
  matched_profile_id?: string;
  matched_profile_name?: string;
  matched_by?: string;
  matched_product_id?: string;
  matched_tariff_id?: string;
  _source?: string;
  _translit_name?: string;
  _queue_id?: string;
}

interface ApiDebugInfo {
  api_calls: Array<{ url: string; method: string; status?: number; count?: number; error?: string }>;
  errors: string[];
  fallback_used: boolean;
}

interface RawSubscription {
  id: string;
  type: string;
  state: string;
  tracking_id?: string;
  created_at: string;
  updated_at?: string;
  amount: number | null;
  currency: string;
  plan_title?: string;
  interval?: string;
  interval_count?: number;
  customer_email?: string;
  customer_name?: string;
  customer_phone?: string;
  card_last_4?: string;
  card_brand?: string;
  card_holder?: string;
  transactions_count: number;
  transactions: any[];
}

interface BepaidRawDataTabProps {
  dateFilter: DateFilter;
}

export default function BepaidRawDataTab({ dateFilter }: BepaidRawDataTabProps) {
  const navigate = useNavigate();
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [activeView, setActiveView] = useState<"transactions" | "subscriptions">("transactions");
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [transactionToLink, setTransactionToLink] = useState<RawTransaction | null>(null);
  const queryClient = useQueryClient();

  // Fetch raw data from bePaid
  const { data: rawData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["bepaid-raw-data", dateFilter.from, dateFilter.to],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("bepaid-raw-transactions", {
        body: {
          fromDate: dateFilter.from,
          toDate: dateFilter.to || new Date().toISOString().split("T")[0],
          perPage: 100,
        },
      });

      if (error) {
        throw new Error(error.message || "Failed to fetch raw data");
      }

      return data as {
        success: boolean;
        api_success?: boolean;
        transactions: RawTransaction[];
        subscriptions: RawSubscription[];
        summary: {
          total_transactions: number;
          total_subscriptions: number;
          successful_transactions: number;
          failed_transactions: number;
          matched_contacts: number;
          unmatched_contacts: number;
        };
        debug?: ApiDebugInfo;
      };
    },
    staleTime: 30000,
  });

  const apiSuccess = rawData?.api_success;
  const debugInfo = rawData?.debug;

  // Sync selected items to queue
  const syncMutation = useMutation({
    mutationFn: async (items: RawTransaction[]) => {
      const results = [];
      
      for (const item of items) {
        // Check if already exists in queue
        const { data: existing } = await supabase
          .from("payment_reconcile_queue")
          .select("id")
          .eq("bepaid_uid", item.uid)
          .maybeSingle();

        if (existing) {
          results.push({ uid: item.uid, status: "exists" });
          continue;
        }

        // Insert into queue with all new fields
        const insertData: any = {
          bepaid_uid: item.uid,
          tracking_id: item.tracking_id,
          amount: item.amount,
          currency: item.currency,
          customer_email: item.customer_email,
          card_last4: item.card_last_4,
          card_holder: item.card_holder,
          plan_title: item.plan_title,
          description: item.description,
          ip_address: item.ip_address,
          receipt_url: item.receipt_url,
          product_name: item.product_name,
          tariff_name: item.tariff_name,
          matched_profile_id: item.matched_profile_id,
          matched_product_id: item.matched_product_id,
          matched_tariff_id: item.matched_tariff_id,
          paid_at: item.paid_at,
          bank_code: item.bank_code,
          rrn: item.rrn,
          auth_code: item.auth_code,
          raw_payload: item as unknown as Record<string, unknown>,
          source: "manual_raw_sync",
          status: ["successful", "succeeded", "completed", "paid"].includes(item.status?.toLowerCase()) ? "pending" : "error",
          last_error: !["successful", "succeeded", "completed", "paid"].includes(item.status?.toLowerCase()) ? `bePaid status: ${item.status}` : null,
        };

        const { error } = await supabase.from("payment_reconcile_queue").insert(insertData);

        if (error) {
          results.push({ uid: item.uid, status: "error", error: error.message });
        } else {
          results.push({ uid: item.uid, status: "added" });
        }
      }

      return results;
    },
    onSuccess: (results) => {
      const added = results.filter(r => r.status === "added").length;
      const exists = results.filter(r => r.status === "exists").length;
      const errors = results.filter(r => r.status === "error").length;

      if (added > 0) {
        toast.success(`Добавлено ${added} транзакций в очередь`);
      }
      if (exists > 0) {
        toast.info(`${exists} уже в очереди`);
      }
      if (errors > 0) {
        toast.error(`Ошибок: ${errors}`);
      }

      setSelectedItems(new Set());
      queryClient.invalidateQueries({ queryKey: ["bepaid-queue"] });
    },
    onError: (error) => {
      toast.error("Ошибка синхронизации: " + error.message);
    },
  });

  const transactions = rawData?.transactions || [];
  const subscriptions = rawData?.subscriptions || [];
  const summary = rawData?.summary;

  const toggleSelectAll = () => {
    if (activeView === "transactions") {
      if (selectedItems.size === transactions.length) {
        setSelectedItems(new Set());
      } else {
        setSelectedItems(new Set(transactions.map(t => t.uid)));
      }
    }
  };

  const toggleItem = (uid: string) => {
    const newSet = new Set(selectedItems);
    if (newSet.has(uid)) {
      newSet.delete(uid);
    } else {
      newSet.add(uid);
    }
    setSelectedItems(newSet);
  };

  const handleSyncSelected = () => {
    const itemsToSync = transactions.filter(t => selectedItems.has(t.uid));
    if (itemsToSync.length === 0) {
      toast.warning("Выберите транзакции для синхронизации");
      return;
    }
    syncMutation.mutate(itemsToSync);
  };

  const handleSyncAll = () => {
    syncMutation.mutate(transactions);
  };

  const getStatusBadge = (status: string) => {
    const s = status?.toLowerCase();
    switch (s) {
      case "successful":
      case "succeeded":
      case "completed":
      case "paid":
        return <Badge variant="default" className="bg-green-600">Оплачено</Badge>;
      case "failed":
      case "error":
      case "declined":
        return <Badge variant="destructive">Ошибка</Badge>;
      case "pending":
        return <Badge variant="secondary">Ожидание</Badge>;
      case "active":
        return <Badge variant="default">Активна</Badge>;
      case "trial":
        return <Badge variant="secondary">Пробная</Badge>;
      case "past_due":
        return <Badge variant="outline" className="border-amber-500 text-amber-600">Просрочена</Badge>;
      case "canceled":
        return <Badge variant="outline">Отменена</Badge>;
      case "expired":
        return <Badge variant="secondary">Истекла</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTypeBadge = (type?: string) => {
    switch (type) {
      case "subscription_payment":
        return <Badge variant="secondary" className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"><Repeat className="h-3 w-3 mr-1" />Подписка</Badge>;
      case "subscription":
        return <Badge variant="secondary" className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"><Repeat className="h-3 w-3 mr-1" />Подписка</Badge>;
      case "transaction":
      default:
        return <Badge variant="outline"><ShoppingCart className="h-3 w-3 mr-1" />Разовый</Badge>;
    }
  };

  const exportTransactions = () => {
    if (transactions.length === 0) return;
    
    const csv = [
      ["UID", "Дата/время", "Сумма", "Валюта", "Статус", "Продукт", "Тариф", "Email", "Имя", "Телефон", "IP", "Карта", "Чек", "Контакт найден", "Tracking ID"].join(";"),
      ...transactions.map(t => [
        t.uid,
        t.paid_at || t.created_at ? format(new Date(t.paid_at || t.created_at!), "dd.MM.yyyy HH:mm:ss") : "",
        t.amount || "",
        t.currency,
        t.status,
        t.product_name || "",
        t.tariff_name || "",
        t.customer_email || "",
        t.customer_name || "",
        t.customer_phone || "",
        t.ip_address || "",
        t.card_last_4 ? `*${t.card_last_4}` : "",
        t.receipt_url || "",
        t.matched_profile_id ? "Да" : "Нет",
        t.tracking_id || "",
      ].join(";"))
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bepaid-raw-${format(new Date(), "yyyy-MM-dd-HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Экспорт завершён");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Транзакции bePaid
            </CardTitle>
            <CardDescription>
              Данные из bePaid API с автоматическим определением клиентов и продуктов
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => refetch()} 
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Обновить
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={exportTransactions}
              disabled={transactions.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Экспорт CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* API Status Banner */}
        {rawData && (
          <div className={`flex items-center gap-2 p-3 rounded-lg ${apiSuccess ? "bg-green-100 dark:bg-green-950/30 text-green-800 dark:text-green-300" : "bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300"}`}>
            {apiSuccess ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-sm font-medium">Данные загружены из bePaid API</span>
              </>
            ) : (
              <>
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm font-medium">
                  {debugInfo?.fallback_used ? "API недоступен, показаны данные из локальной БД" : "Нет данных из API за выбранный период"}
                </span>
              </>
            )}
            {debugInfo?.errors && debugInfo.errors.length > 0 && (
              <span className="text-xs ml-2">({debugInfo.errors.length} ошибок)</span>
            )}
          </div>
        )}

        {/* Debug Info (collapsible) */}
        {debugInfo && debugInfo.errors.length > 0 && (
          <details className="bg-muted/30 rounded-lg p-3">
            <summary className="text-sm font-medium cursor-pointer">🔧 Debug информация</summary>
            <div className="mt-2 space-y-2 text-xs font-mono">
              {debugInfo.api_calls.map((call, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Badge variant={call.status === 200 ? "default" : "destructive"} className="text-xs">
                    {call.status || "ERR"}
                  </Badge>
                  <span>{call.method} {call.url.replace(/https:\/\/[^/]+/, "")}</span>
                  {call.count !== undefined && <span className="text-muted-foreground">({call.count} записей)</span>}
                </div>
              ))}
              {debugInfo.errors.map((err, i) => (
                <div key={i} className="text-destructive">❌ {err}</div>
              ))}
            </div>
          </details>
        )}

        {/* Summary */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold">{summary.total_transactions}</div>
              <div className="text-xs text-muted-foreground">Транзакций</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-600">{summary.successful_transactions}</div>
              <div className="text-xs text-muted-foreground">Успешных</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-destructive">{summary.failed_transactions}</div>
              <div className="text-xs text-muted-foreground">Ошибок</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold">{summary.total_subscriptions}</div>
              <div className="text-xs text-muted-foreground">Подписок</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-600">{summary.matched_contacts}</div>
              <div className="text-xs text-muted-foreground">Найдено контактов</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-amber-600">{summary.unmatched_contacts}</div>
              <div className="text-xs text-muted-foreground">Без контакта</div>
            </div>
          </div>
        )}

        {/* Sync actions */}
        {selectedItems.size > 0 && (
          <div className="flex items-center gap-3 p-3 bg-primary/10 rounded-lg">
            <span className="text-sm font-medium">
              Выбрано: {selectedItems.size}
            </span>
            <Button 
              size="sm" 
              onClick={handleSyncSelected}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-4 w-4 mr-2" />
              )}
              Добавить в очередь
            </Button>
            <Button 
              size="sm" 
              variant="secondary"
              onClick={handleSyncAll}
              disabled={syncMutation.isPending}
            >
              Добавить все ({transactions.length})
            </Button>
          </div>
        )}

        {/* View toggle */}
        <div className="flex gap-2">
          <Button
            variant={activeView === "transactions" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveView("transactions")}
          >
            Транзакции ({transactions.length})
          </Button>
          <Button
            variant={activeView === "subscriptions" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveView("subscriptions")}
          >
            Подписки ({subscriptions.length})
          </Button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="ml-3 text-muted-foreground">Загрузка данных из bePaid...</span>
          </div>
        ) : activeView === "transactions" ? (
          transactions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Нет транзакций за выбранный период</p>
              <p className="text-sm mt-1">Проверьте даты фильтра или нажмите "Обновить"</p>
            </div>
          ) : (
            <div className="max-h-[600px] overflow-auto">
              <Table className="min-w-[1400px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedItems.size === transactions.length && transactions.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Дата/время</TableHead>
                    <TableHead>Тип</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Продукт / Тариф</TableHead>
                    <TableHead>Клиент</TableHead>
                    <TableHead>Контакт в базе</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Карта</TableHead>
                    <TableHead>Чек</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.uid} className={tx.matched_profile_id ? "bg-green-50/30 dark:bg-green-950/10" : ""}>
                      <TableCell>
                        <Checkbox
                          checked={selectedItems.has(tx.uid)}
                          onCheckedChange={() => toggleItem(tx.uid)}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {(tx._bepaid_time || tx.paid_at || tx.created_at) && (
                          <div>
                            <div>{format(new Date(tx._bepaid_time || tx.paid_at || tx.created_at!), "dd.MM.yyyy", { locale: ru })}</div>
                            <div className="text-xs text-muted-foreground">
                              {format(new Date(tx._bepaid_time || tx.paid_at || tx.created_at!), "HH:mm:ss")}
                            </div>
                          </div>
                        )}
                      </TableCell>
                    <TableCell>
                      {getTypeBadge(tx.type)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <div className="font-semibold">{tx.amount} {tx.currency}</div>
                    </TableCell>
                      <TableCell>
                        {getStatusBadge(tx.status)}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          {tx.product_name ? (
                            <>
                              <div className="flex items-center gap-1 font-medium">
                                <Package className="h-3 w-3 text-primary" />
                                <span>{tx.product_name}</span>
                              </div>
                              {tx.tariff_name && (
                                <div className="text-xs text-muted-foreground pl-4">
                                  {tx.tariff_name}
                                </div>
                              )}
                            </>
                          ) : tx.plan_title ? (
                            <div className="max-w-[150px] truncate text-sm" title={tx.plan_title}>
                              {tx.plan_title}
                            </div>
                          ) : tx.description ? (
                            <div className="max-w-[150px] truncate text-xs text-muted-foreground" title={tx.description}>
                              {tx.description}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          {tx.customer_email && (
                            <div className="flex items-center gap-1 text-sm">
                              <Mail className="h-3 w-3 text-muted-foreground" />
                              <span className="truncate max-w-[140px]">{tx.customer_email}</span>
                            </div>
                          )}
                          {tx.customer_name && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <User className="h-3 w-3" />
                              <span>{tx.customer_name}</span>
                            </div>
                          )}
                          {tx.customer_phone && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Phone className="h-3 w-3" />
                              <span>{tx.customer_phone}</span>
                            </div>
                          )}
                        </div>
                    </TableCell>
                    <TableCell>
                      {tx.matched_profile_id ? (
                        <ClickableContactName
                          profileId={tx.matched_profile_id}
                          name={tx.matched_profile_name || "Контакт найден"}
                          email={tx.customer_email}
                          showEmail={false}
                          fromPage="bepaid-sync"
                          className="text-sm"
                        />
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-amber-600 hover:text-amber-700"
                          onClick={() => {
                            setTransactionToLink(tx);
                            setLinkDialogOpen(true);
                          }}
                        >
                          <UserPlus className="h-4 w-4 mr-1" />
                          Связать
                        </Button>
                      )}
                    </TableCell>
                      <TableCell>
                        {tx.ip_address ? (
                          <div className="flex items-center gap-1 text-xs">
                            <Globe className="h-3 w-3 text-muted-foreground" />
                            <span className="font-mono">{tx.ip_address}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {tx.card_last_4 && (
                          <div>
                            <div className="flex items-center gap-1 text-sm">
                              <CreditCard className="h-3 w-3" />
                              <span>*{tx.card_last_4}</span>
                              {tx.card_brand && (
                                <Badge variant="outline" className="text-xs ml-1">{tx.card_brand}</Badge>
                              )}
                            </div>
                            {tx.card_holder && (
                              <div className="text-xs text-muted-foreground truncate max-w-[100px]" title={tx.card_holder}>
                                {tx.card_holder}
                              </div>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {tx.receipt_url ? (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-7 px-2"
                            onClick={() => window.open(tx.receipt_url, "_blank")}
                          >
                            <Receipt className="h-4 w-4 mr-1" />
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        ) : (
          // Subscriptions view
          subscriptions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Нет подписок за выбранный период</p>
            </div>
          ) : (
            <div className="max-h-[600px] overflow-auto">
              <Table className="min-w-[1000px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Дата создания</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead>План</TableHead>
                    <TableHead>Интервал</TableHead>
                    <TableHead>Клиент</TableHead>
                    <TableHead>Карта</TableHead>
                    <TableHead className="text-right">Транзакций</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.map((sub) => (
                    <TableRow key={sub.id}>
                      <TableCell className="font-mono text-xs">
                        {sub.id.slice(0, 12)}...
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {format(new Date(sub.created_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(sub.state)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {sub.amount} {sub.currency}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[150px] truncate" title={sub.plan_title}>
                          {sub.plan_title || "—"}
                        </div>
                      </TableCell>
                      <TableCell>
                        {sub.interval && sub.interval_count ? (
                          <span className="text-sm">
                            {sub.interval_count} {sub.interval}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          {sub.customer_email && (
                            <div className="flex items-center gap-1 text-sm">
                              <Mail className="h-3 w-3 text-muted-foreground" />
                              <span className="truncate max-w-[140px]">{sub.customer_email}</span>
                            </div>
                          )}
                          {sub.customer_name && (
                            <div className="text-xs text-muted-foreground">{sub.customer_name}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {sub.card_last_4 && (
                          <div className="flex items-center gap-1 text-sm">
                            <CreditCard className="h-3 w-3" />
                            <span>*{sub.card_last_4}</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary">{sub.transactions_count}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        )}

        {/* Link dialog */}
        <LinkTransactionDialog
          open={linkDialogOpen}
          onOpenChange={setLinkDialogOpen}
          transaction={transactionToLink}
          onLinked={() => refetch()}
        />
      </CardContent>
    </Card>
  );
}
