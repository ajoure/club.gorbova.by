import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { CreditCard, Plus, Star, Trash2, AlertTriangle } from "lucide-react";

interface PaymentMethod {
  id: string;
  user_id: string;
  provider: string;
  provider_token: string;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
  status: string;
  created_at: string;
}

interface Subscription {
  id: string;
  status: string;
  payment_method_id: string | null;
}

export default function PaymentMethodsSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: paymentMethods, isLoading } = useQuery({
    queryKey: ["user-payment-methods", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("payment_methods")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data as PaymentMethod[];
    },
    enabled: !!user,
  });

  const { data: activeSubscriptions } = useQuery({
    queryKey: ["user-active-subscriptions", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("subscriptions_v2")
        .select("id, status, payment_method_id")
        .eq("user_id", user.id)
        .in("status", ["active", "trial"]);
      
      if (error) throw error;
      return data as Subscription[];
    },
    enabled: !!user,
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (methodId: string) => {
      if (!user) throw new Error("Не авторизован");
      
      // First, unset all defaults
      await supabase
        .from("payment_methods")
        .update({ is_default: false })
        .eq("user_id", user.id);
      
      // Then set the new default
      const { error } = await supabase
        .from("payment_methods")
        .update({ is_default: true })
        .eq("id", methodId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-payment-methods"] });
      toast.success("Карта назначена основной");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (methodId: string) => {
      if (!user) throw new Error("Не авторизован");
      
      const method = paymentMethods?.find(m => m.id === methodId);
      const otherMethods = paymentMethods?.filter(m => m.id !== methodId) || [];
      
      // Check if this is the only card and there are active subscriptions
      if (otherMethods.length === 0 && activeSubscriptions && activeSubscriptions.length > 0) {
        throw new Error("Нельзя удалить единственную карту при наличии активных подписок");
      }
      
      // Mark as revoked instead of deleting
      const { error } = await supabase
        .from("payment_methods")
        .update({ status: "revoked" })
        .eq("id", methodId);
      
      if (error) throw error;
      
      // If this was default and there are other cards, set another as default
      if (method?.is_default && otherMethods.length > 0) {
        await supabase
          .from("payment_methods")
          .update({ is_default: true })
          .eq("id", otherMethods[0].id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-payment-methods"] });
      toast.success("Карта отвязана");
      setDeletingId(null);
    },
    onError: (error) => {
      toast.error(error.message);
      setDeletingId(null);
    },
  });

  const handleAddCard = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("payment-methods-tokenize", {
        body: { action: "create-session" },
      });
      
      if (error) throw error;
      
      if (data?.redirect_url) {
        window.location.href = data.redirect_url;
      } else {
        toast.error("Не удалось создать сессию токенизации");
      }
    } catch (error: any) {
      toast.error("Ошибка: " + error.message);
    }
  };

  const getCardIcon = (brand: string | null) => {
    // Could add specific brand icons here
    return <CreditCard className="h-8 w-8" />;
  };

  const formatExpiry = (month: number | null, year: number | null) => {
    if (!month || !year) return "—";
    return `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`;
  };

  const isExpired = (month: number | null, year: number | null) => {
    if (!month || !year) return false;
    const now = new Date();
    const expDate = new Date(year, month - 1);
    return expDate < now;
  };

  const canDelete = (methodId: string) => {
    const otherMethods = paymentMethods?.filter(m => m.id !== methodId) || [];
    if (otherMethods.length === 0 && activeSubscriptions && activeSubscriptions.length > 0) {
      return false;
    }
    return true;
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Оплата и карты</h1>
          <p className="text-muted-foreground">Управление способами оплаты</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  Привязанные карты
                </CardTitle>
                <CardDescription>
                  Карты для автоматических списаний и быстрой оплаты
                </CardDescription>
              </div>
              <Button onClick={handleAddCard} className="gap-2">
                <Plus className="h-4 w-4" />
                Привязать карту
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : paymentMethods && paymentMethods.length > 0 ? (
              <div className="space-y-4">
                {paymentMethods.map((method) => {
                  const expired = isExpired(method.exp_month, method.exp_year);
                  
                  return (
                    <div
                      key={method.id}
                      className={`flex items-center justify-between p-4 rounded-lg border ${
                        expired ? "bg-destructive/5 border-destructive/30" : "bg-muted/30"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="text-muted-foreground">
                          {getCardIcon(method.brand)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {method.brand?.toUpperCase() || "Карта"} •••• {method.last4 || "****"}
                            </span>
                            {method.is_default && (
                              <Badge variant="secondary" className="gap-1">
                                <Star className="h-3 w-3" />
                                Основная
                              </Badge>
                            )}
                            {expired && (
                              <Badge variant="destructive" className="gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                Истекла
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Действует до: {formatExpiry(method.exp_month, method.exp_year)}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {!method.is_default && !expired && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDefaultMutation.mutate(method.id)}
                            disabled={setDefaultMutation.isPending}
                          >
                            Сделать основной
                          </Button>
                        )}
                        
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={!canDelete(method.id)}
                              title={!canDelete(method.id) ? "Нельзя удалить единственную карту при активных подписках" : "Отвязать карту"}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Отвязать карту?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Карта {method.brand?.toUpperCase()} •••• {method.last4} будет отвязана от вашего аккаунта.
                                {method.is_default && paymentMethods.length > 1 && (
                                  <span className="block mt-2 text-amber-600">
                                    Другая карта будет назначена основной.
                                  </span>
                                )}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Отмена</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(method.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Отвязать
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <CreditCard className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="mb-4">У вас нет привязанных карт</p>
                <Button onClick={handleAddCard} variant="outline" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Привязать первую карту
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info card about 1-click payments */}
        <Card className="bg-muted/30 border-dashed">
          <CardContent className="pt-6">
            <div className="flex gap-4">
              <div className="shrink-0">
                <Star className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-medium mb-1">Оплата в 1 клик</h3>
                <p className="text-sm text-muted-foreground">
                  Если у вас есть основная карта, при покупке подписок оплата будет проходить автоматически без повторного ввода данных карты.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}