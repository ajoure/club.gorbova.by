import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, ShoppingBag, History } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
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
import { SubscriptionListItem } from "@/components/purchases/SubscriptionListItem";
import { SubscriptionDetailSheet } from "@/components/purchases/SubscriptionDetailSheet";
import { OrderListItem } from "@/components/purchases/OrderListItem";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
    provider_response: {
      transaction?: {
        receipt_url?: string;
      };
    } | null;
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
  next_charge_at: string | null;
  created_at: string;
  products_v2: {
    id: string;
    name: string;
    code: string;
  } | null;
  tariffs: {
    id: string;
    name: string;
    code: string;
  } | null;
  payment_methods: {
    brand: string | null;
    last4: string | null;
  } | null;
}

export default function Purchases() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [subscriptionToCancel, setSubscriptionToCancel] = useState<SubscriptionV2 | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedSubscription, setSelectedSubscription] = useState<SubscriptionV2 | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);

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
          payments_v2(id, status, provider_payment_id, card_brand, card_last4, provider_response)
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
          id, status, is_trial, access_start_at, access_end_at, trial_end_at, cancel_at, canceled_at, next_charge_at, created_at,
          products_v2(id, name, code),
          tariffs(id, name, code),
          payment_methods(brand, last4)
        `)
        .eq("user_id", user.id)
        .order("access_end_at", { ascending: false });
      
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
      setDetailSheetOpen(false);
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
      setDetailSheetOpen(false);
    } catch (error) {
      console.error("Resume error:", error);
      toast.error("Ошибка восстановления подписки");
    } finally {
      setIsProcessing(false);
    }
  };

  const openCancelDialog = (sub: SubscriptionV2) => {
    setSubscriptionToCancel(sub);
    setCancelDialogOpen(true);
  };

  const openSubscriptionDetail = (sub: SubscriptionV2) => {
    setSelectedSubscription(sub);
    setDetailSheetOpen(true);
  };

  const downloadReceipt = (order: OrderV2) => {
    const priceFormatted = `${order.final_price.toFixed(2)} ${order.currency}`;
    const dateFormatted = format(new Date(order.created_at), "d MMMM yyyy, HH:mm", { locale: ru });
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
    
    const productName = order.products_v2?.code && order.tariffs?.name
      ? `${order.products_v2.code} — ${order.tariffs.name}`
      : order.products_v2?.name || "Подписка";
    
    doc.setFont("helvetica", "normal");
    doc.text("Продукт:", 20, y);
    doc.text(productName, 80, y);
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
    const paymentMethod = payment?.card_brand && payment?.card_last4
      ? `${payment.card_brand} **** ${payment.card_last4}`
      : order.is_trial && order.final_price === 0
        ? "Пробный период"
        : "Банковская карта";
    
    doc.text("Способ оплаты:", 20, y);
    doc.text(paymentMethod, 80, y);
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

  // Filter active subscriptions (current ones, not expired and not canceled)
  // Show only the latest subscription per product
  const activeSubscriptions = subscriptions?.filter(s => {
    const isExpired = s.access_end_at && new Date(s.access_end_at) < new Date();
    const isCanceled = s.canceled_at !== null;
    // Show subscription if not expired, OR if canceled but still has access
    return !isExpired;
  }) || [];

  // Deduplicate: keep only the subscription with the latest access_end_at per product
  // Prioritize non-canceled subscriptions over canceled ones
  const uniqueActiveSubscriptions = activeSubscriptions.reduce((acc, sub) => {
    const key = sub.products_v2?.id || 'unknown';
    const existing = acc.find(s => (s.products_v2?.id || 'unknown') === key);
    if (!existing) {
      acc.push(sub);
    } else {
      // Prioritize non-canceled subscriptions
      const existingCanceled = existing.canceled_at !== null;
      const currentCanceled = sub.canceled_at !== null;
      
      if (existingCanceled && !currentCanceled) {
        // Current is not canceled, prefer it
        const idx = acc.indexOf(existing);
        acc[idx] = sub;
      } else if (!existingCanceled && currentCanceled) {
        // Existing is not canceled, keep it
        // Do nothing
      } else {
        // Both have same canceled status - keep the one with later access_end_at
        const existingEnd = existing.access_end_at ? new Date(existing.access_end_at).getTime() : 0;
        const currentEnd = sub.access_end_at ? new Date(sub.access_end_at).getTime() : 0;
        if (currentEnd > existingEnd) {
          const idx = acc.indexOf(existing);
          acc[idx] = sub;
        }
      }
    }
    return acc;
  }, [] as SubscriptionV2[]);

  // History: expired subscriptions
  const expiredSubscriptions = subscriptions?.filter(s => {
    const isExpired = s.access_end_at && new Date(s.access_end_at) < new Date();
    return isExpired;
  }) || [];

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Мои покупки</h1>
          <p className="text-muted-foreground">Управление подписками и история платежей</p>
        </div>

        {/* Active Subscriptions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <CreditCard className="h-5 w-5" />
              Активные подписки
            </CardTitle>
          </CardHeader>
          <CardContent>
            {subscriptionsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : uniqueActiveSubscriptions.length > 0 ? (
              <div className="space-y-3">
                {uniqueActiveSubscriptions.map((sub) => (
                  <SubscriptionListItem
                    key={sub.id}
                    subscription={sub}
                    onClick={() => openSubscriptionDetail(sub)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">У вас пока нет активных подписок</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* History Section with Tabs */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <History className="h-5 w-5" />
              История
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="orders" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="orders">Платежи</TabsTrigger>
                <TabsTrigger value="subscriptions">Прошлые подписки</TabsTrigger>
              </TabsList>

              <TabsContent value="orders">
                {ordersLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : orders && orders.length > 0 ? (
                  <div className="space-y-3">
                    {orders.map((order) => (
                      <OrderListItem
                        key={order.id}
                        order={order}
                        onDownloadReceipt={downloadReceipt}
                        onOpenBePaidReceipt={(url) => window.open(url, '_blank')}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <ShoppingBag className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">История платежей пуста</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="subscriptions">
                {subscriptionsLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : expiredSubscriptions.length > 0 ? (
                  <div className="space-y-3">
                    {expiredSubscriptions.map((sub) => (
                      <SubscriptionListItem
                        key={sub.id}
                        subscription={sub}
                        onClick={() => openSubscriptionDetail(sub)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <History className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">Нет прошлых подписок</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Subscription Detail Sheet */}
      <SubscriptionDetailSheet
        subscription={selectedSubscription}
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        onCancel={openCancelDialog}
        onResume={handleResumeSubscription}
        isProcessing={isProcessing}
      />

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
