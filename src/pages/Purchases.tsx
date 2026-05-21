import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, ShoppingBag, History, ClipboardList, FileText, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrderDocuments } from "@/components/purchases/OrderDocuments";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";
import { generateOrderReceipt, generateSubscriptionReceipt } from "@/utils/receiptGenerator";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";
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
import { PreregistrationListItem } from "@/components/purchases/PreregistrationListItem";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTelegramLinkStatus } from "@/hooks/useTelegramLink";

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
    receipt_url: string | null;
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
  order_id: string | null;
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
  orders_v2: {
    id: string;
    order_number: string;
    final_price: number;
    currency: string;
    created_at: string;
    payments_v2: Array<{
      id: string;
      status: string;
      provider_payment_id: string | null;
      card_brand: string | null;
      card_last4: string | null;
      receipt_url: string | null;
      provider_response: {
        transaction?: {
          receipt_url?: string;
        };
      } | null;
    }>;
  } | null;
}

interface CoursePreregistration {
  id: string;
  product_code: string;
  tariff_name: string | null;
  status: string;
  created_at: string;
  notes: string | null;
}

export default function Purchases() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [subscriptionToCancel, setSubscriptionToCancel] = useState<SubscriptionV2 | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedSubscription, setSelectedSubscription] = useState<SubscriptionV2 | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [documentsOrderId, setDocumentsOrderId] = useState<string | null>(null);
  
  // Check Telegram link status
  const { data: telegramStatus } = useTelegramLinkStatus();
  const isTelegramLinked = telegramStatus?.status === 'active';

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
          offer_id, tariff_id, payer_type,
          products_v2(name, code),
          tariffs(name, code),
          payments_v2(id, status, provider, provider_payment_id, card_brand, card_last4, receipt_url, provider_response)
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
          id, status, is_trial, access_start_at, access_end_at, trial_end_at, cancel_at, canceled_at, next_charge_at, created_at, order_id,
          products_v2(id, name, code),
          tariffs(id, name, code),
          payment_methods(brand, last4),
          orders_v2!subscriptions_v2_order_id_fkey(
            id, order_number, final_price, currency, created_at,
            payments_v2(id, status, provider_payment_id, card_brand, card_last4, receipt_url, provider_response)
          )
        `)
        .eq("user_id", user.id)
        .order("access_end_at", { ascending: false });
      
      if (error) throw error;
      return data as SubscriptionV2[];
    },
    enabled: !!user,
  });

  // Fetch preregistrations
  const { data: preregistrations, isLoading: preregistrationsLoading } = useQuery({
    queryKey: ["user-preregistrations", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("course_preregistrations")
        .select("id, product_code, tariff_name, status, created_at, notes")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data as CoursePreregistration[];
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

      if (error) {
        const msg = normalizeEdgeFunctionError(error, data);
        toast.error(msg);
        return;
      }
      if (!data?.success) {
        const msg = normalizeEdgeFunctionError(null, data) || data?.error || "Не удалось возобновить подписку";
        toast.error(msg);
        return;
      }

      toast.success("Подписка восстановлена");
      queryClient.invalidateQueries({ queryKey: ["user-subscriptions-v2"] });
      setDetailSheetOpen(false);
    } catch (error) {
      console.error("Resume error:", error);
      toast.error(normalizeEdgeFunctionError(error));
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

  const downloadReceipt = async (order: OrderV2) => {
    await generateOrderReceipt(order);
  };

  // Download receipt for subscription (uses related order)
  const downloadSubscriptionReceipt = async (sub: SubscriptionV2) => {
    await generateSubscriptionReceipt(sub);
  };

  // STRICT active filter: only real active access (status active/trial/trialing) AND not expired.
  // past_due / unpaid / incomplete / pending — НЕ активные подписки, уезжают в историю.
  const ACTIVE_STATUSES = new Set(["active", "trial", "trialing"]);
  const activeSubscriptions = subscriptions?.filter(s => {
    const isExpired = s.access_end_at && new Date(s.access_end_at) < new Date();
    const statusOk = ACTIVE_STATUSES.has(String(s.status).toLowerCase());
    return statusOk && !isExpired;
  }) || [];

  // Deduplicate: keep only the subscription with the latest access_end_at per product
  // Prioritize non-canceled subscriptions over canceled ones
  const uniqueActiveSubscriptions = activeSubscriptions.reduce((acc, sub) => {
    const key = sub.products_v2?.id || 'unknown';
    const existing = acc.find(s => (s.products_v2?.id || 'unknown') === key);
    if (!existing) {
      acc.push(sub);
    } else {
      const existingCanceled = existing.canceled_at !== null;
      const currentCanceled = sub.canceled_at !== null;
      if (existingCanceled && !currentCanceled) {
        const idx = acc.indexOf(existing);
        acc[idx] = sub;
      } else if (!existingCanceled && currentCanceled) {
        // keep existing
      } else {
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

  // History: subscriptions that are NOT in active set (expired OR non-active status like past_due/unpaid/incomplete/canceled-finished)
  const activeIds = new Set(uniqueActiveSubscriptions.map(s => s.id));
  const historySubscriptions = subscriptions?.filter(s => !activeIds.has(s.id)) || [];

  // Payments tab: hide pure "in-progress" noise — only paid/failed/refunded matter to the user.
  // pending/processing/created — это шум без действий, не показываем.
  const VISIBLE_ORDER_STATUSES = new Set(["paid", "failed", "refunded"]);
  const VISIBLE_PAYMENT_STATUSES = new Set(["succeeded", "failed", "refunded"]);
  const visibleOrders = orders?.filter(o => {
    const orderOk = VISIBLE_ORDER_STATUSES.has(String(o.status).toLowerCase());
    const payOk = o.payments_v2?.some(p => VISIBLE_PAYMENT_STATUSES.has(String(p.status).toLowerCase()));
    return orderOk || payOk;
  }) || [];

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto w-full min-w-0 space-y-4 sm:space-y-6 px-3 sm:px-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Мои покупки</h1>
          <p className="text-sm sm:text-base text-muted-foreground">Управление подписками и история платежей</p>
        </div>

        {/* Active Subscriptions */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-3 px-4 sm:px-6">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <CreditCard className="h-5 w-5 shrink-0" />
              Активные подписки
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 sm:px-6">
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
                
                {/* Telegram reminder for active subscriptions */}
                {!isTelegramLinked && (
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-4 mt-4">
                    <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 mb-2">
                      <MessageCircle className="h-5 w-5" />
                      <span className="font-medium">Привяжите Telegram для получения доступов</span>
                    </div>
                    <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">
                      Ссылки на чат и канал клуба будут отправлены автоматически после привязки.
                    </p>
                    <Button variant="outline" size="sm" onClick={() => window.location.href = '/dashboard'}>
                      Привязать Telegram
                    </Button>
                  </div>
                )}
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
        <Card className="overflow-hidden">
          <CardHeader className="pb-3 px-4 sm:px-6">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <History className="h-5 w-5 shrink-0" />
              История
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 sm:px-6">
            <Tabs defaultValue="orders" className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-4 h-auto">
                <TabsTrigger value="orders" className="text-xs sm:text-sm py-2 px-1 sm:px-3">Платежи</TabsTrigger>
                <TabsTrigger value="subscriptions" className="text-xs sm:text-sm py-2 px-1 sm:px-3">
                  <span className="sm:hidden">Подписки</span>
                  <span className="hidden sm:inline">Прошлые подписки</span>
                </TabsTrigger>
                <TabsTrigger value="preregistrations" className="text-xs sm:text-sm py-2 px-1 sm:px-3">Предзаписи</TabsTrigger>
              </TabsList>

              <TabsContent value="orders">
                {ordersLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : visibleOrders && visibleOrders.length > 0 ? (
                  <div className="space-y-3">
                    {visibleOrders.map((order) => (
                      <OrderListItem key={order.id} order={order} />
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
                ) : historySubscriptions.length > 0 ? (
                  <div className="space-y-3">
                    {historySubscriptions.map((sub) => (
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

              <TabsContent value="preregistrations">
                {preregistrationsLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : preregistrations && preregistrations.length > 0 ? (
                  <div className="space-y-3">
                    {preregistrations.map((prereg) => (
                      <PreregistrationListItem
                        key={prereg.id}
                        preregistration={prereg}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">Нет предзаписей на курсы</p>
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
        onDownloadReceipt={downloadSubscriptionReceipt}
        lastPaidOrderId={selectedSubscription?.orders_v2?.id || selectedSubscription?.order_id || null}
        receiptUrl={(() => {
          const p = selectedSubscription?.orders_v2?.payments_v2?.[0] as any;
          return p?.receipt_url || p?.provider_response?.transaction?.receipt_url || null;
        })()}
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

      {/* Order Documents Sheet */}
      <OrderDocuments
        orderId={documentsOrderId}
        open={!!documentsOrderId}
        onOpenChange={(open) => !open && setDocumentsOrderId(null)}
      />
    </DashboardLayout>
  );
}
