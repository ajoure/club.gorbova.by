import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  RefreshCw, Download, CreditCard, Mail, Phone, User, 
  CheckCircle2, AlertCircle, FileText, Clock, ArrowRightLeft, Loader2
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  paid_at?: string;
  created_at?: string;
  plan_title?: string;
  customer_email?: string;
  customer_name?: string;
  customer_phone?: string;
  card_last_4?: string;
  card_brand?: string;
  card_holder?: string;
  tracking_id?: string;
  message?: string;
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
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [activeView, setActiveView] = useState<"transactions" | "subscriptions">("transactions");
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
        transactions: RawTransaction[];
        subscriptions: RawSubscription[];
        customers: any[];
        summary: {
          total_transactions: number;
          total_subscriptions: number;
          total_customers: number;
          successful_transactions: number;
          failed_transactions: number;
        };
      };
    },
    staleTime: 30000,
  });

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

        // Insert into queue
        const { error } = await supabase.from("payment_reconcile_queue").insert({
          bepaid_uid: item.uid,
          tracking_id: item.tracking_id,
          amount: item.amount,
          currency: item.currency,
          customer_email: item.customer_email,
          card_last4: item.card_last_4,
          card_holder: item.card_holder,
          plan_title: item.plan_title,
          raw_payload: item as unknown as Record<string, unknown>,
          source: "manual_raw_sync",
          status: item.status === "successful" ? "pending" : "error",
          last_error: item.status !== "successful" ? `bePaid status: ${item.status}` : null,
        } as any);

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
        return <Badge variant="default" className="bg-green-600">succeeded</Badge>;
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

  const exportTransactions = () => {
    if (transactions.length === 0) return;
    
    const csv = [
      ["UID", "Дата", "Сумма", "Валюта", "Статус", "Продукт", "Email", "Имя", "Телефон", "Карта", "Tracking ID"].join(";"),
      ...transactions.map(t => [
        t.uid,
        t.paid_at || t.created_at ? format(new Date(t.paid_at || t.created_at!), "dd.MM.yyyy HH:mm") : "",
        t.amount || "",
        t.currency,
        t.status,
        t.plan_title || "",
        t.customer_email || "",
        t.customer_name || "",
        t.customer_phone || "",
        t.card_last_4 ? `*${t.card_last_4}` : "",
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
              Сырые данные bePaid
            </CardTitle>
            <CardDescription>
              Прямые данные из API bePaid для выбора и синхронизации
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
              Обновить из bePaid
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
        {/* Summary */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
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
              <div className="text-2xl font-bold">{summary.total_customers}</div>
              <div className="text-xs text-muted-foreground">Клиентов</div>
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
              <p className="text-sm mt-1">Проверьте даты фильтра или нажмите "Обновить из bePaid"</p>
            </div>
          ) : (
            <div className="max-h-[600px] overflow-auto">
              <Table className="min-w-[1000px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedItems.size === transactions.length && transactions.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Дата</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Продукт</TableHead>
                    <TableHead>Клиент</TableHead>
                    <TableHead>Карта</TableHead>
                    <TableHead>Tracking ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.uid}>
                      <TableCell>
                        <Checkbox
                          checked={selectedItems.has(tx.uid)}
                          onCheckedChange={() => toggleItem(tx.uid)}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {(tx.paid_at || tx.created_at) && 
                          format(new Date(tx.paid_at || tx.created_at!), "dd.MM.yyyy HH:mm", { locale: ru })}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {tx.amount} {tx.currency}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(tx.status)}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[150px] truncate" title={tx.plan_title}>
                          {tx.plan_title || "—"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          {tx.customer_email && (
                            <div className="flex items-center gap-1 text-sm">
                              <Mail className="h-3 w-3 text-muted-foreground" />
                              <span className="truncate max-w-[150px]">{tx.customer_email}</span>
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
                        {tx.card_last_4 && (
                          <div className="flex items-center gap-1 text-sm">
                            <CreditCard className="h-3 w-3" />
                            <span>*{tx.card_last_4}</span>
                            {tx.card_brand && (
                              <Badge variant="outline" className="text-xs ml-1">{tx.card_brand}</Badge>
                            )}
                          </div>
                        )}
                        {tx.card_holder && (
                          <div className="text-xs text-muted-foreground truncate max-w-[120px]">
                            {tx.card_holder}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-mono truncate max-w-[100px]" title={tx.tracking_id}>
                          {tx.tracking_id || "—"}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        ) : (
          /* Subscriptions view */
          subscriptions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Нет подписок за выбранный период</p>
            </div>
          ) : (
            <div className="max-h-[600px] overflow-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Создана</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>План</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead>Клиент</TableHead>
                    <TableHead>Транзакций</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.map((sub) => (
                    <TableRow key={sub.id}>
                      <TableCell className="font-mono text-xs">
                        {sub.id.substring(0, 8)}...
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {format(new Date(sub.created_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(sub.state)}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[150px] truncate" title={sub.plan_title}>
                          {sub.plan_title || "—"}
                        </div>
                        {sub.interval && (
                          <div className="text-xs text-muted-foreground">
                            {sub.interval_count} {sub.interval}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {sub.amount} {sub.currency}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          {sub.customer_email && (
                            <div className="flex items-center gap-1 text-sm">
                              <Mail className="h-3 w-3 text-muted-foreground" />
                              <span className="truncate max-w-[150px]">{sub.customer_email}</span>
                            </div>
                          )}
                          {sub.customer_name && (
                            <div className="text-xs text-muted-foreground">{sub.customer_name}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{sub.transactions_count}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}
