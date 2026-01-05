import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CreditCard, RefreshCw, XCircle, PlayCircle, Calendar, Clock, AlertTriangle } from "lucide-react";

interface Subscription {
  id: string;
  user_id: string;
  product_id: string;
  tariff_id: string | null;
  status: string;
  is_trial: boolean;
  access_start_at: string;
  access_end_at: string | null;
  trial_end_at: string | null;
  next_charge_at: string | null;
  cancel_at: string | null;
  payment_method_id: string | null;
  payment_token: string | null;
  meta: Record<string, any> | null;
  created_at: string;
  products_v2: {
    name: string;
    code: string;
  } | null;
  tariffs: {
    name: string;
    code: string;
  } | null;
  payment_methods: {
    brand: string | null;
    last4: string | null;
  } | null;
}

interface PaymentMethod {
  id: string;
  brand: string | null;
  last4: string | null;
  is_default: boolean;
}

export default function SubscriptionsSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [changeCardSubId, setChangeCardSubId] = useState<string | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>("");

  const { data: subscriptions, isLoading } = useQuery({
    queryKey: ["user-subscriptions-full", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("subscriptions_v2")
        .select(`
          *,
          products_v2(name, code),
          tariffs(name, code),
          payment_methods(brand, last4)
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data as Subscription[];
    },
    enabled: !!user,
  });

  const { data: paymentMethods } = useQuery({
    queryKey: ["user-payment-methods", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("payment_methods")
        .select("id, brand, last4, is_default")
        .eq("user_id", user.id)
        .eq("status", "active");
      
      if (error) throw error;
      return data as PaymentMethod[];
    },
    enabled: !!user,
  });

  const cancelMutation = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const { data, error } = await supabase.functions.invoke("subscription-actions", {
        body: { action: "cancel", subscription_id: subscriptionId },
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-subscriptions-full"] });
      toast.success("Подписка будет отменена в конце периода");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const { data, error } = await supabase.functions.invoke("subscription-actions", {
        body: { action: "resume", subscription_id: subscriptionId },
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-subscriptions-full"] });
      toast.success("Подписка возобновлена");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  const changePaymentMethodMutation = useMutation({
    mutationFn: async ({ subscriptionId, paymentMethodId }: { subscriptionId: string; paymentMethodId: string }) => {
      const { data, error } = await supabase.functions.invoke("subscription-actions", {
        body: { 
          action: "change-payment-method", 
          subscription_id: subscriptionId,
          payment_method_id: paymentMethodId,
        },
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-subscriptions-full"] });
      toast.success("Карта списания изменена");
      setChangeCardSubId(null);
      setSelectedPaymentMethod("");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "—";
    return format(new Date(dateString), "d MMMM yyyy, HH:mm", { locale: ru });
  };

  const getStatusBadge = (sub: Subscription) => {
    const isCanceled = sub.cancel_at && new Date(sub.cancel_at) > new Date();
    
    if (sub.status === "canceled") {
      return <Badge variant="secondary">Отменена</Badge>;
    }
    if (isCanceled) {
      return (
        <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
          <Clock className="h-3 w-3" />
          Отменяется
        </Badge>
      );
    }
    if (sub.status === "trialing" || sub.is_trial) {
      return (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
          Пробный период
        </Badge>
      );
    }
    if (sub.status === "active") {
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          Активна
        </Badge>
      );
    }
    if (sub.status === "past_due") {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          Просрочена
        </Badge>
      );
    }
    return <Badge variant="outline">{sub.status}</Badge>;
  };

  const canCancel = (sub: Subscription) => {
    return (sub.status === "active" || sub.status === "trialing") && !sub.cancel_at;
  };

  const canResume = (sub: Subscription) => {
    return sub.cancel_at && new Date(sub.cancel_at) > new Date() && sub.status !== "canceled";
  };

  const getAccessUntil = (sub: Subscription) => {
    if (sub.cancel_at) return sub.cancel_at;
    if (sub.is_trial && sub.trial_end_at) return sub.trial_end_at;
    return sub.access_end_at;
  };

  const currentSub = subscriptions?.find(s => s.id === changeCardSubId);

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Подписки</h1>
          <p className="text-muted-foreground">Управление вашими подписками</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Мои подписки
            </CardTitle>
            <CardDescription>
              Активные, пробные и отменённые подписки
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : subscriptions && subscriptions.length > 0 ? (
              <div className="space-y-4">
                {subscriptions.map((sub) => {
                  const accessUntil = getAccessUntil(sub);
                  
                  return (
                    <div
                      key={sub.id}
                      className="p-4 rounded-lg border bg-card"
                    >
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">
                              {sub.products_v2?.name || "Продукт"}
                            </h3>
                            {getStatusBadge(sub)}
                          </div>
                          
                          {sub.tariffs && (
                            <p className="text-sm text-muted-foreground">
                              Тариф: {sub.tariffs.name}
                            </p>
                          )}
                          
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Calendar className="h-4 w-4" />
                              <span>
                                Доступ до: {formatDate(accessUntil)}
                              </span>
                            </div>
                            
                            {sub.next_charge_at && !sub.cancel_at && (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <Clock className="h-4 w-4" />
                                <span>
                                  Списание: {formatDate(sub.next_charge_at)}
                                </span>
                              </div>
                            )}
                            
                            {(sub.payment_methods || sub.payment_token) && (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <CreditCard className="h-4 w-4" />
                                <span>
                                  Карта: {sub.payment_methods?.brand?.toUpperCase() || "••••"} •••• {sub.payment_methods?.last4 || "****"}
                                </span>
                              </div>
                            )}
                          </div>
                          
                          {sub.cancel_at && (
                            <p className="text-sm text-amber-600 dark:text-amber-400">
                              Подписка будет отменена {formatDate(sub.cancel_at)}
                            </p>
                          )}
                        </div>
                        
                        <div className="flex flex-wrap gap-2">
                          {canResume(sub) && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => resumeMutation.mutate(sub.id)}
                              disabled={resumeMutation.isPending}
                              className="gap-1"
                            >
                              <PlayCircle className="h-4 w-4" />
                              Возобновить
                            </Button>
                          )}
                          
                          {canCancel(sub) && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="outline" size="sm" className="gap-1">
                                  <XCircle className="h-4 w-4" />
                                  Отменить
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Отменить подписку?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {sub.is_trial ? (
                                      <>
                                        Ваш пробный период закончится {formatDate(sub.trial_end_at)}.
                                        После этого доступ будет закрыт и оплата не спишется.
                                      </>
                                    ) : (
                                      <>
                                        Доступ сохранится до {formatDate(sub.access_end_at)}.
                                        После этого подписка будет отменена и автоматические списания прекратятся.
                                      </>
                                    )}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Оставить подписку</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => cancelMutation.mutate(sub.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Отменить подписку
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                          
                          {sub.status === "active" && !sub.cancel_at && paymentMethods && paymentMethods.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setChangeCardSubId(sub.id);
                                setSelectedPaymentMethod(sub.payment_method_id || "");
                              }}
                              className="gap-1"
                            >
                              <CreditCard className="h-4 w-4" />
                              Сменить карту
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <RefreshCw className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>У вас нет подписок</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Change Payment Method Dialog */}
      <Dialog open={!!changeCardSubId} onOpenChange={(open) => !open && setChangeCardSubId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Сменить карту списания</DialogTitle>
            <DialogDescription>
              Выберите карту для автоматических списаний по подписке "{currentSub?.products_v2?.name}"
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <Select value={selectedPaymentMethod} onValueChange={setSelectedPaymentMethod}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите карту" />
              </SelectTrigger>
              <SelectContent>
                {paymentMethods?.map((pm) => (
                  <SelectItem key={pm.id} value={pm.id}>
                    {pm.brand?.toUpperCase() || "Карта"} •••• {pm.last4 || "****"}
                    {pm.is_default && " (Основная)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeCardSubId(null)}>
              Отмена
            </Button>
            <Button
              onClick={() => {
                if (changeCardSubId && selectedPaymentMethod) {
                  changePaymentMethodMutation.mutate({
                    subscriptionId: changeCardSubId,
                    paymentMethodId: selectedPaymentMethod,
                  });
                }
              }}
              disabled={!selectedPaymentMethod || changePaymentMethodMutation.isPending}
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}