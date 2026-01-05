import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShoppingBag, CheckCircle, XCircle, Clock, CreditCard, Download, Ban, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
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

interface OrderV2 {
  id: string;
  order_number: string;
  final_price: number;
  currency: string;
  status: string;
  is_trial: boolean;
  trial_end_at: string | null;
  customer_email: string | null;
  created_at: string;
  meta: Record<string, any> | null;
  purchase_snapshot: Record<string, any> | null;
  products_v2: {
    name: string;
    code: string;
  } | null;
  tariffs: {
    name: string;
    code: string;
  } | null;
  payments_v2: Array<{
    id: string;
    status: string;
    provider_payment_id: string | null;
    card_brand: string | null;
    card_last4: string | null;
  }>;
}

interface SubscriptionV2 {
  id: string;
  status: string;
  is_trial: boolean;
  access_start_at: string;
  access_end_at: string | null;
  trial_end_at: string | null;
  cancel_at: string | null;
  canceled_at: string | null;
  created_at: string;
  products_v2: {
    id: string;
    name: string;
    code: string;
  } | null;
  tariffs: {
    name: string;
    code: string;
  } | null;
}

export default function Purchases() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [renewProduct, setRenewProduct] = useState<{ id: string; name: string; price: number } | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [subscriptionToCancel, setSubscriptionToCancel] = useState<SubscriptionV2 | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Fetch orders from orders_v2
  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ["user-orders-v2", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("orders_v2")
        .select(`
          id, order_number, final_price, currency, status, is_trial, trial_end_at,
          customer_email, created_at, meta, purchase_snapshot,
          products_v2(name, code),
          tariffs(name, code),
          payments_v2(id, status, provider_payment_id, card_brand, card_last4)
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data as OrderV2[];
    },
    enabled: !!user,
  });

  // Fetch subscriptions from subscriptions_v2
  const { data: subscriptions, isLoading: subscriptionsLoading } = useQuery({
    queryKey: ["user-subscriptions-v2", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("subscriptions_v2")
        .select(`
          id, status, is_trial, access_start_at, access_end_at, trial_end_at, cancel_at, canceled_at, created_at,
          products_v2(id, name, code),
          tariffs(name, code)
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data as SubscriptionV2[];
    },
    enabled: !!user,
  });

  const handleCancelSubscription = async () => {
    if (!subscriptionToCancel) return;
    
    setIsProcessing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("subscription-actions", {
        body: {
          action: "cancel",
          subscription_id: subscriptionToCancel.id,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Failed to cancel");

      toast.success("Подписка отменена", {
        description: `Доступ сохранится до ${format(new Date(data.cancel_at), "d MMMM yyyy", { locale: ru })}`,
      });
      
      queryClient.invalidateQueries({ queryKey: ["user-subscriptions-v2"] });
    } catch (error) {
      console.error("Cancel error:", error);
      toast.error("Ошибка отмены подписки");
    } finally {
      setIsProcessing(false);
      setCancelDialogOpen(false);
      setSubscriptionToCancel(null);
    }
  };

  const handleResumeSubscription = async (sub: SubscriptionV2) => {
    setIsProcessing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("subscription-actions", {
        body: {
          action: "resume",
          subscription_id: sub.id,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Failed to resume");

      toast.success("Подписка восстановлена");
      queryClient.invalidateQueries({ queryKey: ["user-subscriptions-v2"] });
    } catch (error) {
      console.error("Resume error:", error);
      toast.error("Ошибка восстановления подписки");
    } finally {
      setIsProcessing(false);
    }
  };

  const getOrderStatusBadge = (order: OrderV2) => {
    const payment = order.payments_v2?.[0];
    
    if (order.status === "paid" || payment?.status === "succeeded") {
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          <CheckCircle className="mr-1 h-3 w-3" />
          Оплачено
        </Badge>
      );
    }
    if (order.status === "failed" || payment?.status === "failed") {
      return (
        <Badge variant="destructive">
          <XCircle className="mr-1 h-3 w-3" />
          Ошибка
        </Badge>
      );
    }
    if (order.status === "pending" || order.status === "processing") {
      return (
        <Badge variant="secondary">
          <Clock className="mr-1 h-3 w-3" />
          В обработке
        </Badge>
      );
    }
    return <Badge variant="outline">{order.status}</Badge>;
  };

  const getSubscriptionStatusBadge = (sub: SubscriptionV2) => {
    const isExpired = sub.access_end_at && new Date(sub.access_end_at) < new Date();
    
    if (sub.status === "active" && !isExpired) {
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          <CheckCircle className="mr-1 h-3 w-3" />
          Активна
        </Badge>
      );
    }
    if (sub.status === "trial" && !isExpired) {
      return (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
          <Clock className="mr-1 h-3 w-3" />
          Пробный период
        </Badge>
      );
    }
    if (isExpired || sub.status === "expired") {
      return (
        <Badge variant="secondary">
          <Clock className="mr-1 h-3 w-3" />
          Истекла
        </Badge>
      );
    }
    if (sub.status === "canceled") {
      return (
        <Badge variant="outline">
          <XCircle className="mr-1 h-3 w-3" />
          Отменена
        </Badge>
      );
    }
    return <Badge variant="outline">{sub.status}</Badge>;
  };

  const formatPrice = (amount: number, currency: string) => {
    return `${amount.toFixed(2)} ${currency}`;
  };

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), "d MMMM yyyy, HH:mm", { locale: ru });
  };

  const getOrderProductName = (order: OrderV2): string => {
    const productName = order.products_v2?.name || order.purchase_snapshot?.product_name || "";
    const tariffName = order.tariffs?.name || order.purchase_snapshot?.tariff_name || "";
    
    if (productName && tariffName) {
      return `${order.products_v2?.code || ""} — ${tariffName}`;
    }
    if (productName) return productName;
    if (order.is_trial) return "Пробный период";
    return "—";
  };

  const getPaymentMethod = (order: OrderV2): { label: string; icon: React.ReactNode } => {
    if (order.is_trial && order.final_price === 0) {
      return { label: "Пробный период", icon: <Clock className="h-3 w-3" /> };
    }
    
    const payment = order.payments_v2?.[0];
    if (payment?.card_brand && payment?.card_last4) {
      return { 
        label: `${payment.card_brand} **** ${payment.card_last4}`, 
        icon: <CreditCard className="h-3 w-3" /> 
      };
    }
    
    return { label: "Банковская карта", icon: <CreditCard className="h-3 w-3" /> };
  };

  const downloadReceipt = (order: OrderV2) => {
    const priceFormatted = formatPrice(order.final_price, order.currency);
    const dateFormatted = formatDate(order.created_at);
    const payment = order.payments_v2?.[0];
    
    const doc = new jsPDF();
    
    // Header background
    doc.setFillColor(102, 126, 234);
    doc.rect(0, 0, 210, 45, "F");
    
    // Logo text
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.text("Gorbova Club", 105, 22, { align: "center" });
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text("КВИТАНЦИЯ ОБ ОПЛАТЕ", 105, 35, { align: "center" });
    
    // Reset text color
    doc.setTextColor(51, 51, 51);
    
    // Order info section
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("ИНФОРМАЦИЯ О ЗАКАЗЕ", 20, 60);
    doc.setDrawColor(102, 126, 234);
    doc.line(20, 63, 190, 63);
    
    doc.setFont("helvetica", "normal");
    let y = 73;
    
    doc.text("Номер заказа:", 20, y);
    doc.text(order.order_number, 80, y);
    y += 8;
    
    doc.text("ID транзакции:", 20, y);
    doc.text(payment?.provider_payment_id || "—", 80, y);
    y += 8;
    
    doc.text("Дата и время:", 20, y);
    doc.text(dateFormatted, 80, y);
    y += 15;
    
    // Product section
    doc.setFont("helvetica", "bold");
    doc.text("ДЕТАЛИ ЗАКАЗА", 20, y);
    doc.line(20, y + 3, 190, y + 3);
    y += 13;
    
    doc.setFont("helvetica", "normal");
    doc.text("Продукт:", 20, y);
    doc.text(getOrderProductName(order), 80, y);
    y += 8;
    
    doc.text("Тип:", 20, y);
    doc.text(order.is_trial ? "Пробный период" : "Подписка", 80, y);
    y += 15;
    
    // Payment section
    doc.setFont("helvetica", "bold");
    doc.text("ИНФОРМАЦИЯ ОБ ОПЛАТЕ", 20, y);
    doc.line(20, y + 3, 190, y + 3);
    y += 13;
    
    doc.setFont("helvetica", "normal");
    const paymentInfo = getPaymentMethod(order);
    doc.text("Способ оплаты:", 20, y);
    doc.text(paymentInfo.label, 80, y);
    y += 8;
    
    doc.text("Статус:", 20, y);
    doc.setTextColor(16, 185, 129);
    doc.text("Оплачено", 80, y);
    doc.setTextColor(51, 51, 51);
    y += 8;
    
    doc.text("Email покупателя:", 20, y);
    doc.text(order.customer_email || "—", 80, y);
    y += 20;
    
    // Total section
    doc.setFillColor(245, 247, 250);
    doc.roundedRect(20, y - 5, 170, 25, 3, 3, "F");
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("ИТОГО:", 30, y + 10);
    doc.setTextColor(102, 126, 234);
    doc.text(priceFormatted, 180, y + 10, { align: "right" });
    doc.setTextColor(51, 51, 51);
    y += 35;
    
    // Footer
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(107, 114, 128);
    doc.text("Исполнитель: ЗАО «АЖУР инкам»", 105, y, { align: "center" });
    doc.text("УНП: 193405000", 105, y + 5, { align: "center" });
    doc.text("Адрес: 220035, г. Минск, ул. Панфилова, 2, офис 49Л", 105, y + 10, { align: "center" });
    doc.text("Email: info@ajoure.by", 105, y + 15, { align: "center" });
    y += 25;
    
    doc.setFontSize(8);
    doc.text("Данный документ сформирован автоматически и является подтверждением оплаты.", 105, y, { align: "center" });
    
    // Save the PDF
    doc.save(`receipt_${order.order_number}_${format(new Date(order.created_at), "yyyyMMdd")}.pdf`);
    
    toast.success("PDF-чек скачан");
  };

  // Filter active subscriptions
  const activeSubscriptions = subscriptions?.filter(s => {
    const isExpired = s.access_end_at && new Date(s.access_end_at) < new Date();
    return (s.status === "active" || s.status === "trial") && !isExpired;
  }) || [];

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Мои покупки</h1>
          <p className="text-muted-foreground">История заказов и активные подписки</p>
        </div>

        {/* Active Subscriptions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Подписки
            </CardTitle>
            <CardDescription>
              Ваши текущие подписки и продукты
            </CardDescription>
          </CardHeader>
          <CardContent>
            {subscriptionsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : activeSubscriptions.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {activeSubscriptions.map((sub) => {
                  const isExpiringSoon = sub.access_end_at && 
                    new Date(sub.access_end_at) < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
                  const isCanceled = !!sub.cancel_at;
                  
                  return (
                    <div
                      key={sub.id}
                      className={`rounded-lg border p-4 ${
                        isCanceled
                          ? "bg-muted/30 border-muted"
                          : isExpiringSoon 
                            ? "bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/30"
                            : "bg-gradient-to-br from-primary/5 to-accent/5"
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-semibold text-foreground">
                            {sub.products_v2?.code || sub.products_v2?.name || "Подписка"} — {sub.tariffs?.name || (sub.is_trial ? "Пробный период" : "Подписка")}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            Активирована: {formatDate(sub.access_start_at)}
                          </p>
                          {sub.access_end_at && (
                            <p className={`text-sm ${isExpiringSoon ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                              Действует до: {formatDate(sub.access_end_at)}
                            </p>
                          )}
                          {isCanceled && sub.cancel_at && (
                            <p className="text-sm text-destructive">
                              Отменена, доступ до: {format(new Date(sub.cancel_at), "d MMMM yyyy", { locale: ru })}
                            </p>
                          )}
                        </div>
                        {getSubscriptionStatusBadge(sub)}
                      </div>
                      
                      {/* Cancel/Resume buttons */}
                      <div className="flex gap-2 mt-2">
                        {isCanceled ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleResumeSubscription(sub)}
                            disabled={isProcessing}
                            className="gap-1"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Восстановить
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSubscriptionToCancel(sub);
                              setCancelDialogOpen(true);
                            }}
                            disabled={isProcessing}
                            className="gap-1 text-muted-foreground hover:text-destructive"
                          >
                            <Ban className="h-3 w-3" />
                            Отменить
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <CreditCard className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>У вас пока нет активных подписок</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Order History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" />
              История заказов
            </CardTitle>
            <CardDescription>
              Все ваши покупки и платежи
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ordersLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : orders && orders.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Продукт</TableHead>
                    <TableHead>Сумма</TableHead>
                    <TableHead>Способ оплаты</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => {
                    const paymentInfo = getPaymentMethod(order);
                    const isPaid = order.status === "paid" || order.payments_v2?.[0]?.status === "succeeded";
                    
                    return (
                      <TableRow key={order.id}>
                        <TableCell className="whitespace-nowrap">
                          {formatDate(order.created_at)}
                        </TableCell>
                        <TableCell className="font-medium">
                          {getOrderProductName(order)}
                        </TableCell>
                        <TableCell>
                          {formatPrice(order.final_price, order.currency)}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1">
                            {paymentInfo.icon}
                            {paymentInfo.label}
                          </span>
                        </TableCell>
                        <TableCell>{getOrderStatusBadge(order)}</TableCell>
                        <TableCell className="text-right">
                          {isPaid && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => downloadReceipt(order)}
                              className="gap-1"
                            >
                              <Download className="h-4 w-4" />
                              <span className="hidden sm:inline">Чек</span>
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <ShoppingBag className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>История покупок пуста</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payment Dialog for Renewal */}
      {renewProduct && (
        <PaymentDialog
          open={!!renewProduct}
          onOpenChange={(open) => !open && setRenewProduct(null)}
          productId={renewProduct.id}
          productName={renewProduct.name}
          price={`${(renewProduct.price / 100).toFixed(2)} BYN`}
        />
      )}

      {/* Cancel Subscription Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отменить подписку?</AlertDialogTitle>
            <AlertDialogDescription>
              {subscriptionToCancel && (
                <>
                  Подписка <strong>{subscriptionToCancel.products_v2?.code || "Подписка"}</strong> будет отменена.
                  <br />
                  Доступ сохранится до окончания оплаченного периода
                  {subscriptionToCancel.access_end_at && (
                    <> — <strong>{format(new Date(subscriptionToCancel.access_end_at), "d MMMM yyyy", { locale: ru })}</strong></>
                  )}.
                  <br /><br />
                  Автоматическое продление будет отключено.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelSubscription}
              disabled={isProcessing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isProcessing ? "Отмена..." : "Да, отменить подписку"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
