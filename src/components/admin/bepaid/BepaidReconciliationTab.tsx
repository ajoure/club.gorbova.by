import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  RefreshCw, Download, AlertTriangle, CheckCircle2, 
  AlertCircle, ArrowRightLeft, User, ShoppingCart,
  DollarSign, Calendar, Loader2
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useBepaidQueueActions } from "@/hooks/useBepaidMappings";

interface DateFilter {
  from: string;
  to?: string;
}

interface ReconciliationItem {
  id: string;
  bepaid_uid: string;
  bepaid_amount: number;
  bepaid_currency: string;
  bepaid_paid_at: string | null;
  bepaid_status: string;
  customer_email: string | null;
  card_holder: string | null;
  matched_profile_id: string | null;
  matched_profile_name: string | null;
  matched_order_id: string | null;
  // From joined order
  order_number: string | null;
  order_amount: number | null;
  order_status: string | null;
  order_paid_at: string | null;
  // Discrepancy info
  discrepancy_type: 'none' | 'not_found' | 'amount_mismatch' | 'status_mismatch' | 'date_mismatch';
  discrepancy_details?: string;
}

interface ReconciliationStats {
  total: number;
  matched: number;
  not_found: number;
  amount_mismatch: number;
  status_mismatch: number;
  bepaid_total: number;
  system_total: number;
  difference: number;
}

interface BepaidReconciliationTabProps {
  dateFilter: DateFilter;
}

export default function BepaidReconciliationTab({ dateFilter }: BepaidReconciliationTabProps) {
  const [showOnlyDiscrepancies, setShowOnlyDiscrepancies] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const { createOrderFromQueue, isCreatingOrder } = useBepaidQueueActions();

  // Fetch reconciliation data
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["bepaid-reconciliation", dateFilter.from, dateFilter.to],
    queryFn: async () => {
      // Fetch queue items with their matched orders
      const query = supabase
        .from('payment_reconcile_queue')
        .select(`
          id,
          bepaid_uid,
          amount,
          currency,
          paid_at,
          status,
          customer_email,
          matched_profile_id,
          raw_payload,
          profiles:matched_profile_id(full_name)
        `)
        .eq('source', 'file_import')
        .gte('created_at', dateFilter.from)
        .order('created_at', { ascending: false });

      if (dateFilter.to) {
        query.lte('created_at', dateFilter.to + 'T23:59:59');
      }

      const { data: queueItems, error } = await query;
      if (error) throw error;

      // Also fetch payments by bepaid_uid to find matches
      const bepaidUids = (queueItems as any[])?.map((q: any) => q.bepaid_uid).filter(Boolean) as string[];
      
      const { data: payments } = bepaidUids.length > 0 ? await supabase
        .from('payments_v2')
        .select(`
          id,
          provider_payment_id,
          amount,
          status,
          created_at,
          order:order_id(
            id,
            order_number,
            final_price,
            status
          )
        `)
        .in('provider_payment_id', bepaidUids) : { data: [] };

      const paymentMap = new Map<string, any>();
      payments?.forEach(p => {
        if (p.provider_payment_id) paymentMap.set(p.provider_payment_id, p);
      });

      // Process reconciliation
      const items: ReconciliationItem[] = [];
      let stats: ReconciliationStats = {
        total: 0,
        matched: 0,
        not_found: 0,
        amount_mismatch: 0,
        status_mismatch: 0,
        bepaid_total: 0,
        system_total: 0,
        difference: 0,
      };

      for (const q of (queueItems as any[]) || []) {
        stats.total++;
        const bepaidAmount = q.amount || 0;
        stats.bepaid_total += bepaidAmount;

        const profile = q.profiles as { full_name: string | null } | null;
        const rawPayload = q.raw_payload as any || {};
        
        // Check payments table for order
        const payment = paymentMap.get(q.bepaid_uid || '');
        const paymentOrder = payment?.order as { 
          id: string; 
          order_number: string; 
          final_price: number; 
          status: string 
        } | null;

        const finalOrder = paymentOrder;

        let discrepancy_type: ReconciliationItem['discrepancy_type'] = 'none';
        let discrepancy_details: string | undefined;

        if (!finalOrder) {
          discrepancy_type = 'not_found';
          discrepancy_details = 'Заказ не найден в системе';
          stats.not_found++;
        } else {
          stats.system_total += finalOrder.final_price || 0;
          
          // Check amount mismatch (allow 1% tolerance)
          const amountDiff = Math.abs(bepaidAmount - (finalOrder.final_price || 0));
          if (amountDiff > bepaidAmount * 0.01 && amountDiff > 0.5) {
            discrepancy_type = 'amount_mismatch';
            discrepancy_details = `bePaid: ${bepaidAmount} / Система: ${finalOrder.final_price}`;
            stats.amount_mismatch++;
          } else if (q.status === 'pending' && finalOrder.status === 'paid') {
            discrepancy_type = 'status_mismatch';
            discrepancy_details = 'Очередь: pending / Заказ: оплачен';
            stats.status_mismatch++;
          } else {
            stats.matched++;
          }
        }

        items.push({
          id: q.id,
          bepaid_uid: q.bepaid_uid || '',
          bepaid_amount: bepaidAmount,
          bepaid_currency: q.currency || 'BYN',
          bepaid_paid_at: q.paid_at,
          bepaid_status: q.status || 'unknown',
          customer_email: q.customer_email,
          card_holder: rawPayload.card_holder || null,
          matched_profile_id: q.matched_profile_id,
          matched_profile_name: profile?.full_name || null,
          matched_order_id: finalOrder?.id || null,
          order_number: finalOrder?.order_number || null,
          order_amount: finalOrder?.final_price || null,
          order_status: finalOrder?.status || null,
          order_paid_at: null,
          discrepancy_type,
          discrepancy_details,
        });
      }

      stats.difference = stats.bepaid_total - stats.system_total;

      return { items, stats };
    },
    staleTime: 30000,
  });

  const items = data?.items || [];
  const stats = data?.stats;
  const filteredItems = showOnlyDiscrepancies 
    ? items.filter(i => i.discrepancy_type !== 'none')
    : items;

  const toggleSelectAll = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map(i => i.id)));
    }
  };

  const toggleItem = (id: string) => {
    const newSet = new Set(selectedItems);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedItems(newSet);
  };

  const handleCreateMissingOrders = async () => {
    const itemsToCreate = filteredItems.filter(
      i => selectedItems.has(i.id) && i.discrepancy_type === 'not_found' && i.matched_profile_id
    );

    if (itemsToCreate.length === 0) {
      toast.warning("Нет подходящих записей для создания заказов");
      return;
    }

    for (const item of itemsToCreate) {
      createOrderFromQueue({
        queueItemId: item.id,
        profileId: item.matched_profile_id!,
      });
    }
    
    toast.info(`Создание ${itemsToCreate.length} заказов...`);
  };

  const exportReport = () => {
    const csv = [
      ["bePaid UID", "Дата", "Сумма bePaid", "Валюта", "Email", "Контакт", "Заказ", "Сумма заказа", "Расхождение", "Детали"].join(";"),
      ...items.map(i => [
        i.bepaid_uid,
        i.bepaid_paid_at ? format(new Date(i.bepaid_paid_at), "dd.MM.yyyy HH:mm") : "",
        i.bepaid_amount,
        i.bepaid_currency,
        i.customer_email || "",
        i.matched_profile_name || "",
        i.order_number || "",
        i.order_amount || "",
        i.discrepancy_type,
        i.discrepancy_details || "",
      ].join(";"))
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bepaid-reconciliation-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Отчёт экспортирован");
  };

  const getDiscrepancyBadge = (item: ReconciliationItem) => {
    switch (item.discrepancy_type) {
      case 'none':
        return <Badge variant="default" className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />ОК</Badge>;
      case 'not_found':
        return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Нет заказа</Badge>;
      case 'amount_mismatch':
        return <Badge variant="outline" className="border-amber-500 text-amber-600"><DollarSign className="h-3 w-3 mr-1" />Сумма</Badge>;
      case 'status_mismatch':
        return <Badge variant="secondary"><AlertCircle className="h-3 w-3 mr-1" />Статус</Badge>;
      default:
        return <Badge variant="outline">{item.discrepancy_type}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" />
              Сверка bePaid
            </CardTitle>
            <CardDescription>
              Сравнение транзакций bePaid с заказами в системе
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
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
              onClick={exportReport}
              disabled={items.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Экспорт
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Всего</div>
            </div>
            <div className="bg-green-100 dark:bg-green-950/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-600">{stats.matched}</div>
              <div className="text-xs text-muted-foreground">Совпало</div>
            </div>
            <div className="bg-red-100 dark:bg-red-950/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-destructive">{stats.not_found}</div>
              <div className="text-xs text-muted-foreground">Нет заказа</div>
            </div>
            <div className="bg-amber-100 dark:bg-amber-950/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-amber-600">{stats.amount_mismatch}</div>
              <div className="text-xs text-muted-foreground">Расхождение суммы</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold">{stats.bepaid_total.toFixed(2)}</div>
              <div className="text-xs text-muted-foreground">Сумма bePaid</div>
            </div>
            <div className={`rounded-lg p-3 text-center ${stats.difference !== 0 ? 'bg-amber-100 dark:bg-amber-950/30' : 'bg-muted/50'}`}>
              <div className={`text-lg font-bold ${stats.difference !== 0 ? 'text-amber-600' : ''}`}>
                {stats.difference > 0 ? '+' : ''}{stats.difference.toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground">Разница</div>
            </div>
          </div>
        )}

        {/* Filters and actions */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="showDiscrepancies"
              checked={showOnlyDiscrepancies}
              onCheckedChange={(v) => setShowOnlyDiscrepancies(!!v)}
            />
            <label htmlFor="showDiscrepancies" className="text-sm cursor-pointer">
              Только расхождения
            </label>
          </div>
          {selectedItems.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Выбрано: {selectedItems.size}</span>
              <Button 
                size="sm" 
                onClick={handleCreateMissingOrders}
                disabled={isCreatingOrder}
              >
                {isCreatingOrder ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ShoppingCart className="h-4 w-4 mr-2" />
                )}
                Создать заказы
              </Button>
            </div>
          )}
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {showOnlyDiscrepancies ? "Нет расхождений" : "Нет данных для сверки"}
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectedItems.size === filteredItems.length && filteredItems.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead className="text-right">bePaid</TableHead>
                  <TableHead>Email / Карта</TableHead>
                  <TableHead>Контакт</TableHead>
                  <TableHead>Заказ</TableHead>
                  <TableHead className="text-right">В системе</TableHead>
                  <TableHead>Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => (
                  <TableRow 
                    key={item.id}
                    className={item.discrepancy_type !== 'none' ? 'bg-amber-50/50 dark:bg-amber-950/10' : ''}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedItems.has(item.id)}
                        onCheckedChange={() => toggleItem(item.id)}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {item.bepaid_paid_at && format(new Date(item.bepaid_paid_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {item.bepaid_amount} {item.bepaid_currency}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="space-y-0.5">
                        {item.customer_email && (
                          <div className="text-muted-foreground truncate max-w-[150px]">{item.customer_email}</div>
                        )}
                        {item.card_holder && (
                          <div className="text-xs text-muted-foreground">{item.card_holder}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {item.matched_profile_name ? (
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3 text-green-600" />
                          <span className="text-sm">{item.matched_profile_name}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.order_number ? (
                        <Badge variant="outline" className="font-mono">{item.order_number}</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.order_amount !== null ? (
                        <span className={item.discrepancy_type === 'amount_mismatch' ? 'text-amber-600 font-medium' : ''}>
                          {item.order_amount} BYN
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {getDiscrepancyBadge(item)}
                      {item.discrepancy_details && (
                        <div className="text-xs text-muted-foreground mt-0.5">{item.discrepancy_details}</div>
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
  );
}
