import { useEffect, useState } from "react";
import { useSearchParams, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle, Calendar, CreditCard, Loader2, Send, XCircle, RefreshCw, MessageCircle } from "lucide-react";
import { format, addDays } from "date-fns";
import { ru } from "date-fns/locale";

interface OrderInfo {
  order_number: string;
  final_price: number;
  currency: string;
  product_name: string;
  tariff_name: string;
  access_days: number;
  created_at: string;
}

export function GlobalPaymentHandler() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const { user } = useAuth();
  const [successOpen, setSuccessOpen] = useState(false);
  const [failedOpen, setFailedOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null);

  useEffect(() => {
    const paymentStatus = searchParams.get("payment");
    
    if (paymentStatus === "success") {
      setSuccessOpen(true);
      setFailedOpen(false);
      if (user) {
        fetchLastOrder();
      } else {
        setLoading(false);
      }
    } else if (paymentStatus === "failed") {
      setFailedOpen(true);
      setSuccessOpen(false);
    }
  }, [searchParams, user]);

  const fetchLastOrder = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const { data } = await supabase
        .from("orders_v2")
        .select(`
          order_number,
          final_price,
          currency,
          created_at,
          products_v2 (name),
          tariffs (name, access_days)
        `)
        .eq("user_id", user.id)
        .eq("status", "paid")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        setOrderInfo({
          order_number: data.order_number,
          final_price: data.final_price,
          currency: data.currency,
          product_name: (data.products_v2 as any)?.name || "Продукт",
          tariff_name: (data.tariffs as any)?.name || "Тариф",
          access_days: (data.tariffs as any)?.access_days || 30,
          created_at: data.created_at,
        });
      }
    } catch (error) {
      console.error("Error fetching order:", error);
    } finally {
      setLoading(false);
    }
  };

  const clearPaymentParam = () => {
    searchParams.delete("payment");
    setSearchParams(searchParams);
  };

  const handleSuccessClose = () => {
    setSuccessOpen(false);
    clearPaymentParam();
  };

  const handleFailedClose = () => {
    setFailedOpen(false);
    clearPaymentParam();
  };

  const handleRetry = () => {
    handleFailedClose();
    window.location.href = "/pay";
  };

  const formatCurrency = (amount: number, currency: string) => {
    const symbols: Record<string, string> = {
      BYN: "Br",
      USD: "$",
      EUR: "€",
      RUB: "₽",
    };
    return `${amount} ${symbols[currency] || currency}`;
  };

  const getAccessEndDate = () => {
    if (!orderInfo) return "";
    const startDate = new Date(orderInfo.created_at);
    const endDate = addDays(startDate, orderInfo.access_days);
    return format(endDate, "d MMMM yyyy", { locale: ru });
  };

  return (
    <>
      {/* Success Dialog */}
      <Dialog open={successOpen} onOpenChange={(isOpen) => !isOpen && handleSuccessClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <CheckCircle className="h-6 w-6 text-green-500" />
              Оплата прошла успешно!
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : orderInfo ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <CreditCard className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">{orderInfo.product_name}</p>
                    <p className="text-sm text-muted-foreground">{orderInfo.tariff_name}</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <Calendar className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">
                      Доступ на {orderInfo.access_days} дней
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Активен до {getAccessEndDate()}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm bg-muted/50 rounded-lg p-3">
                <span className="text-muted-foreground">Сумма оплаты:</span>
                <span className="font-semibold text-foreground">
                  {formatCurrency(orderInfo.final_price, orderInfo.currency)}
                </span>
              </div>

              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-primary/5 rounded-lg p-3">
                <Send className="h-4 w-4 shrink-0" />
                <span>Ссылки для входа в Telegram-клуб отправлены в бот</span>
              </div>

              <Button onClick={handleSuccessClose} className="w-full">
                Отлично, продолжить
              </Button>
            </div>
          ) : (
            <div className="text-center py-6 space-y-4">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
              <p className="text-muted-foreground">
                Ваша оплата успешно обработана. Доступ активирован!
              </p>
              <Button onClick={handleSuccessClose} className="w-full">
                Продолжить
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Failed Dialog */}
      <Dialog open={failedOpen} onOpenChange={(isOpen) => !isOpen && handleFailedClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <XCircle className="h-6 w-6 text-destructive" />
              Оплата не прошла
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4">
              <p className="text-sm text-foreground">
                К сожалению, платёж не был завершён. Это могло произойти по одной из причин:
              </p>
              <ul className="mt-2 text-sm text-muted-foreground space-y-1">
                <li>• Недостаточно средств на карте</li>
                <li>• Карта заблокирована банком</li>
                <li>• Превышен лимит операций</li>
                <li>• Платёж был отменён</li>
              </ul>
            </div>

            <div className="flex flex-col gap-2">
              <Button onClick={handleRetry} className="w-full">
                <RefreshCw className="mr-2 h-4 w-4" />
                Попробовать снова
              </Button>
              
              <Button variant="outline" onClick={handleFailedClose} className="w-full">
                <MessageCircle className="mr-2 h-4 w-4" />
                Связаться с поддержкой
              </Button>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              Если проблема повторяется, попробуйте использовать другую карту или свяжитесь с банком.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
