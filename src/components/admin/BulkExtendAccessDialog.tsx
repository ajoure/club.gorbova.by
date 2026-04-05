import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, CheckCircle, XCircle, AlertTriangle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

type Step = "setup" | "preview" | "executing" | "done";

interface PreviewRow {
  orderId: string;
  orderNumber: string;
  productName: string;
  userName: string;
  currentEnd: string | null;
  newEnd: string | null;
  action: "применить" | "пропустить" | "заблокировано";
  reason: string;
  subscriptionId?: string;
}

interface BulkExtendAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedOrderIds: string[];
  onSuccess: () => void;
}

export function BulkExtendAccessDialog({
  open, onOpenChange, selectedOrderIds, onSuccess,
}: BulkExtendAccessDialogProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("setup");
  const [days, setDays] = useState(30);
  const [extendFromCurrent, setExtendFromCurrent] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<{ success: number; skipped: number; errors: number }>({ success: 0, skipped: 0, errors: 0 });

  // Fetch order data for preview
  const { data: orderData, isLoading } = useQuery({
    queryKey: ["bulk-extend-preview", selectedOrderIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders_v2")
        .select(`
          id, order_number, user_id, product_id, status,
          products_v2(id, name, is_active),
          profiles!orders_v2_profile_id_fkey(id, email, full_name)
        `)
        .in("id", selectedOrderIds);
      if (error) throw error;
      return data;
    },
    enabled: open && selectedOrderIds.length > 0,
  });

  // Fetch active subscriptions for these users+products
  const { data: subsData } = useQuery({
    queryKey: ["bulk-extend-subs", selectedOrderIds],
    queryFn: async () => {
      if (!orderData) return [];
      const pairs = orderData
        .filter(o => o.user_id && o.product_id)
        .map(o => ({ user_id: o.user_id!, product_id: o.product_id! }));
      if (!pairs.length) return [];

      const userIds = [...new Set(pairs.map(p => p.user_id))];
      const productIds = [...new Set(pairs.map(p => p.product_id))];

      const { data, error } = await supabase
        .from("subscriptions_v2")
        .select("id, user_id, product_id, status, access_end_at")
        .in("user_id", userIds)
        .in("product_id", productIds);
      if (error) throw error;
      return data;
    },
    enabled: !!orderData && orderData.length > 0,
  });

  const previewRows = useMemo((): PreviewRow[] => {
    if (!orderData) return [];

    return orderData.map(order => {
      const product = order.products_v2 as any;
      const profile = order.profiles as any;
      const userName = profile?.full_name || profile?.email || "—";
      const productName = product?.name || "—";

      // STOP-guard: no user_id
      if (!order.user_id) {
        return {
          orderId: order.id, orderNumber: order.order_number || "—",
          productName, userName, currentEnd: null, newEnd: null,
          action: "заблокировано" as const, reason: "Нет user_id у сделки",
        };
      }

      // STOP-guard: no product_id
      if (!order.product_id) {
        return {
          orderId: order.id, orderNumber: order.order_number || "—",
          productName, userName, currentEnd: null, newEnd: null,
          action: "заблокировано" as const, reason: "Нет product_id у сделки",
        };
      }

      // STOP-guard: archived product
      if (product && !product.is_active) {
        return {
          orderId: order.id, orderNumber: order.order_number || "—",
          productName, userName, currentEnd: null, newEnd: null,
          action: "заблокировано" as const, reason: "Архивный продукт — доступ не создаётся",
        };
      }

      // STOP-guard: order not paid
      if (order.status !== "paid") {
        return {
          orderId: order.id, orderNumber: order.order_number || "—",
          productName, userName, currentEnd: null, newEnd: null,
          action: "пропустить" as const, reason: `Сделка не оплачена (${order.status})`,
        };
      }

      // Find active subscription
      const sub = subsData?.find(
        s => s.user_id === order.user_id && s.product_id === order.product_id
          && (s.status === "active" || s.status === "trial")
          && (!s.access_end_at || new Date(s.access_end_at) > new Date())
      );

      if (!sub) {
        // No active subscription = historical, blocked
        return {
          orderId: order.id, orderNumber: order.order_number || "—",
          productName, userName, currentEnd: null, newEnd: null,
          action: "заблокировано" as const,
          reason: "Нет текущего активного доступа — продление невозможно",
        };
      }

      // Calculate new end date
      const baseDate = extendFromCurrent && sub.access_end_at
        ? new Date(sub.access_end_at)
        : new Date();
      const newEnd = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);

      // STOP-guard: new end would be before current end (shrinking)
      if (sub.access_end_at && newEnd < new Date(sub.access_end_at)) {
        return {
          orderId: order.id, orderNumber: order.order_number || "—",
          productName, userName,
          currentEnd: sub.access_end_at,
          newEnd: newEnd.toISOString(),
          action: "заблокировано" as const,
          reason: "Новый срок короче текущего — сокращение заблокировано",
          subscriptionId: sub.id,
        };
      }

      return {
        orderId: order.id, orderNumber: order.order_number || "—",
        productName, userName,
        currentEnd: sub.access_end_at,
        newEnd: newEnd.toISOString(),
        action: "применить" as const,
        reason: `Продление от ${extendFromCurrent ? "текущего срока" : "сегодня"} на ${days} дн.`,
        subscriptionId: sub.id,
      };
    });
  }, [orderData, subsData, days, extendFromCurrent]);

  const applicable = previewRows.filter(r => r.action === "применить");
  const blocked = previewRows.filter(r => r.action === "заблокировано");
  const skipped = previewRows.filter(r => r.action === "пропустить");

  const handleExecute = async () => {
    setStep("executing");
    setProcessing(true);
    let success = 0, errors = 0;

    for (const row of applicable) {
      if (!row.orderId) continue;
      try {
        const { data, error } = await supabase.functions.invoke("grant-access-for-order", {
          body: {
            orderId: row.orderId,
            customAccessDays: days,
            extendFromCurrent,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        success++;
      } catch (e: any) {
        console.error(`[BulkExtend] Error for order ${row.orderId}:`, e);
        errors++;
      }
    }

    setResults({ success, skipped: skipped.length + blocked.length, errors });
    setProcessing(false);
    setStep("done");
    queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
    queryClient.invalidateQueries({ queryKey: ["contact-subscriptions"] });
  };

  const handleClose = () => {
    setStep("setup");
    setDays(30);
    setResults({ success: 0, skipped: 0, errors: 0 });
    onOpenChange(false);
    if (step === "done") onSuccess();
  };

  const formatDate = (d: string | null) =>
    d ? format(new Date(d), "dd.MM.yy") : "∞";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {step === "setup" && "Массовое продление доступа"}
            {step === "preview" && "Предварительный просмотр"}
            {step === "executing" && "Выполнение..."}
            {step === "done" && "Результат"}
          </DialogTitle>
          <DialogDescription>
            {step === "setup" && `Выбрано ${selectedOrderIds.length} сделок`}
            {step === "preview" && (
              <>
                <span className="text-green-600">Применить: {applicable.length}</span>
                {blocked.length > 0 && <span className="ml-3 text-destructive">Заблокировано: {blocked.length}</span>}
                {skipped.length > 0 && <span className="ml-3 text-muted-foreground">Пропущено: {skipped.length}</span>}
              </>
            )}
            {step === "done" && `Успешно: ${results.success}, Пропущено: ${results.skipped}, Ошибки: ${results.errors}`}
          </DialogDescription>
        </DialogHeader>

        {step === "setup" && (
          <div className="space-y-4 py-4">
            <div>
              <Label>Количество дней</Label>
              <Input
                type="number"
                value={days}
                onChange={e => setDays(parseInt(e.target.value) || 30)}
                min={1}
                className="w-40 mt-1"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant={extendFromCurrent ? "default" : "outline"}
                size="sm"
                onClick={() => setExtendFromCurrent(true)}
              >
                От текущего срока
              </Button>
              <Button
                variant={!extendFromCurrent ? "default" : "outline"}
                size="sm"
                onClick={() => setExtendFromCurrent(false)}
              >
                От сегодня
              </Button>
            </div>
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm">
              <div className="flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 mt-0.5 text-amber-600 flex-shrink-0" />
                <div>
                  <p className="font-medium text-amber-800 dark:text-amber-300">Гард основания</p>
                  <p className="text-amber-700 dark:text-amber-400 mt-1">
                    Продление доступно только для сделок с текущим активным доступом. 
                    Исторические, архивные и спорные случаи будут заблокированы.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === "preview" && (
          <ScrollArea className="flex-1 max-h-[50vh]">
            <div className="space-y-2 pr-4">
              {previewRows.map(row => (
                <div
                  key={row.orderId}
                  className={`p-3 rounded-lg border text-sm ${
                    row.action === "применить"
                      ? "border-green-200 bg-green-50 dark:bg-green-900/10"
                      : row.action === "заблокировано"
                      ? "border-destructive/30 bg-destructive/5"
                      : "border-muted bg-muted/30"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">{row.productName}</span>
                    <Badge
                      variant={
                        row.action === "применить" ? "default" :
                        row.action === "заблокировано" ? "destructive" : "secondary"
                      }
                      className="text-xs"
                    >
                      {row.action === "применить" && <CheckCircle className="w-3 h-3 mr-1" />}
                      {row.action === "заблокировано" && <XCircle className="w-3 h-3 mr-1" />}
                      {row.action === "пропустить" && <AlertTriangle className="w-3 h-3 mr-1" />}
                      {row.action}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.userName} · #{row.orderNumber}
                  </div>
                  {row.action === "применить" && (
                    <div className="text-xs mt-1">
                      {formatDate(row.currentEnd)} → <span className="font-medium text-green-700 dark:text-green-400">{formatDate(row.newEnd)}</span>
                    </div>
                  )}
                  <div className="text-xs mt-1 text-muted-foreground">{row.reason}</div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {step === "executing" && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {step === "done" && (
          <div className="py-8 text-center space-y-2">
            <CheckCircle className="w-12 h-12 mx-auto text-green-600" />
            <p className="text-lg font-medium">Готово</p>
            <p className="text-sm text-muted-foreground">
              Успешно продлено: {results.success}
              {results.errors > 0 && ` · Ошибки: ${results.errors}`}
            </p>
          </div>
        )}

        <DialogFooter>
          {step === "setup" && (
            <>
              <Button variant="outline" onClick={handleClose}>Отмена</Button>
              <Button onClick={() => setStep("preview")} disabled={isLoading}>
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Предварительный просмотр
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => setStep("setup")}>Назад</Button>
              <Button
                onClick={handleExecute}
                disabled={applicable.length === 0}
                className="gap-2"
              >
                Применить ({applicable.length})
              </Button>
            </>
          )}
          {step === "done" && (
            <Button onClick={handleClose}>Закрыть</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}