import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, Loader2, CreditCard, Calendar, User, Link2, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface PaymentResult {
  id: string;
  source: 'queue';
  bepaid_uid: string | null;
  amount: number | null;
  currency: string;
  customer_email: string | null;
  customer_phone: string | null;
  card_holder: string | null;
  card_last4: string | null;
  card_brand: string | null;
  paid_at: string | null;
  product_name: string | null;
  description: string | null;
  matched_order_id: string | null;
  match_reason?: string;
}

interface LinkPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNumber?: string;
  orderAmount?: number;
  orderCurrency?: string;
  profileId?: string | null;
  userId?: string | null;
  existingPaymentsCount: number;
  onSuccess: () => void;
}

export function LinkPaymentDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  orderAmount,
  orderCurrency = "BYN",
  profileId,
  userId,
  existingPaymentsCount,
  onSuccess,
}: LinkPaymentDialogProps) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PaymentResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PaymentResult | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSearch("");
      setResults([]);
      setSelectedPayment(null);
    }
  }, [open]);

  const handleSearch = async () => {
    if (!search.trim()) {
      toast.error("Введите поисковый запрос");
      return;
    }

    setSearching(true);
    try {
      const term = search.trim().toLowerCase();

      // Search in payment_reconcile_queue for unlinked payments
      const { data: queueResults, error } = await supabase
        .from("payment_reconcile_queue")
        .select("id, bepaid_uid, amount, currency, customer_email, customer_phone, card_holder, card_last4, card_brand, paid_at, product_name, description, matched_order_id")
        .is("matched_order_id", null) // Only unlinked
        .eq("status", "pending") // Only pending status
        .or(`bepaid_uid.ilike.%${term}%,customer_email.ilike.%${term}%,customer_phone.ilike.%${term}%,card_holder.ilike.%${term}%,card_last4.ilike.%${term}%`)
        .order("paid_at", { ascending: false })
        .limit(30);

      if (error) throw error;

      // Add match reason based on what matched
      const withReasons: PaymentResult[] = (queueResults || []).map(p => {
        let match_reason = "";
        if (p.bepaid_uid?.toLowerCase().includes(term)) match_reason = "UID";
        else if (p.customer_email?.toLowerCase().includes(term)) match_reason = "Email";
        else if (p.customer_phone?.toLowerCase().includes(term)) match_reason = "Телефон";
        else if (p.card_holder?.toLowerCase().includes(term)) match_reason = "Владелец карты";
        else if (p.card_last4?.toLowerCase().includes(term)) match_reason = "Карта";
        
        return { ...p, source: 'queue' as const, match_reason };
      });

      setResults(withReasons);

      if (withReasons.length === 0) {
        toast.info("Платежи не найдены");
      }
    } catch (e: any) {
      console.error("Search error:", e);
      toast.error(`Ошибка поиска: ${e.message}`);
    } finally {
      setSearching(false);
    }
  };

  const handleLinkClick = (payment: PaymentResult) => {
    setSelectedPayment(payment);
    
    // If order already has payments, show confirmation
    if (existingPaymentsCount > 0) {
      setConfirmDialogOpen(true);
    } else {
      handleLink(payment);
    }
  };

  const handleLink = async (payment: PaymentResult) => {
    setLinking(true);
    try {
      const currentUser = (await supabase.auth.getUser()).data.user;
      if (!currentUser) throw new Error("Не авторизован");

      // Call the server action (Edge Function)
      const { data, error } = await supabase.functions.invoke("admin-link-payment-to-order", {
        body: {
          source: "reconcile_queue",
          queue_id: payment.id,
          order_id: orderId,
          profile_id: profileId,
          user_id: userId,
          actor_id: currentUser.id,
        },
      });

      if (error) throw error;

      if (!data.success) {
        // Handle STOP errors
        const errorMessage = getErrorMessage(data.error, data.message);
        toast.error(errorMessage);
        return;
      }

      toast.success("Платёж успешно привязан к сделке");
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      console.error("Link error:", e);
      toast.error(`Ошибка привязки: ${e.message}`);
    } finally {
      setLinking(false);
      setConfirmDialogOpen(false);
    }
  };

  const getErrorMessage = (code: string, message: string): string => {
    switch (code) {
      case "PAYMENT_ALREADY_LINKED":
        return "Этот платёж уже привязан к другой сделке";
      case "DUPLICATE_PROVIDER_UID":
        return "Платёж с таким UID уже существует";
      case "PROFILE_MISMATCH":
        return "Профиль платежа не совпадает с профилем сделки";
      case "ORDER_NOT_FOUND":
        return "Сделка не найдена";
      case "QUEUE_ITEM_NOT_FOUND":
        return "Платёж не найден в очереди";
      default:
        return message || "Неизвестная ошибка";
    }
  };

  const formatAmount = (amount: number | null, currency: string) => {
    if (amount === null) return "—";
    return new Intl.NumberFormat("ru-BY", {
      style: "currency",
      currency: currency,
    }).format(amount);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Привязать платёж к сделке
            </DialogTitle>
            {orderNumber && (
              <p className="text-sm text-muted-foreground">
                Сделка: <span className="font-medium">{orderNumber}</span>
                {orderAmount !== undefined && (
                  <> • {formatAmount(orderAmount, orderCurrency)}</>
                )}
              </p>
            )}
          </DialogHeader>

          <div className="space-y-4 flex-1 min-h-0">
            {/* Search */}
            <div className="flex gap-2">
              <Input
                placeholder="Поиск по UID, email, телефону, карте..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <Button onClick={handleSearch} disabled={searching}>
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>

            {/* Existing payments warning */}
            {existingPaymentsCount > 0 && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
                <span>
                  У сделки уже {existingPaymentsCount} платеж{existingPaymentsCount === 1 ? "" : existingPaymentsCount < 5 ? "а" : "ей"}. 
                  При привязке нового потребуется подтверждение.
                </span>
              </div>
            )}

            {/* Results */}
            {results.length > 0 && (
              <ScrollArea className="flex-1 border rounded-lg max-h-[400px]">
                <div className="p-2 space-y-2">
                  {results.map((payment) => (
                    <div
                      key={payment.id}
                      className="p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">
                              {formatAmount(payment.amount, payment.currency)}
                            </span>
                            {payment.match_reason && (
                              <Badge variant="outline" className="text-xs">
                                {payment.match_reason}
                              </Badge>
                            )}
                          </div>
                          
                          <div className="text-sm text-muted-foreground space-y-0.5">
                            {payment.customer_email && (
                              <div className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                <span className="truncate">{payment.customer_email}</span>
                              </div>
                            )}
                            {payment.card_last4 && (
                              <div className="flex items-center gap-1">
                                <CreditCard className="h-3 w-3" />
                                <span>
                                  {payment.card_brand} •••• {payment.card_last4}
                                  {payment.card_holder && ` (${payment.card_holder})`}
                                </span>
                              </div>
                            )}
                            {payment.paid_at && (
                              <div className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                <span>{format(new Date(payment.paid_at), "dd.MM.yyyy HH:mm", { locale: ru })}</span>
                              </div>
                            )}
                            {payment.product_name && (
                              <div className="text-xs mt-1">
                                Продукт: {payment.product_name}
                              </div>
                            )}
                          </div>

                          {payment.bepaid_uid && (
                            <div className="text-xs text-muted-foreground font-mono truncate">
                              UID: {payment.bepaid_uid}
                            </div>
                          )}
                        </div>

                        <Button
                          size="sm"
                          onClick={() => handleLinkClick(payment)}
                          disabled={linking}
                        >
                          {linking && selectedPayment?.id === payment.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Link2 className="h-4 w-4 mr-1" />
                              Привязать
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            {results.length === 0 && !searching && (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm py-8">
                Введите запрос для поиска платежей в очереди
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation dialog for multiple payments */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Подтвердите привязку</AlertDialogTitle>
            <AlertDialogDescription>
              У сделки уже есть {existingPaymentsCount} платеж{existingPaymentsCount === 1 ? "" : existingPaymentsCount < 5 ? "а" : "ей"}. 
              Вы уверены, что хотите привязать ещё один платёж на сумму{" "}
              <span className="font-medium">
                {selectedPayment && formatAmount(selectedPayment.amount, selectedPayment.currency)}
              </span>
              ?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedPayment && handleLink(selectedPayment)}
              disabled={linking}
            >
              {linking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Привязать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
