import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserPendingInstallments } from "@/hooks/useInstallments";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { CreditCard, Plus, Star, Trash2, AlertTriangle, Check, Loader2, AlertCircle, RefreshCw, Calendar } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

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
  // Verification fields for recurring payments
  recurring_verified: boolean | null;
  verification_status: string | null;
  verification_error: string | null;
  verification_checked_at: string | null;
}

interface Subscription {
  id: string;
  status: string;
  payment_method_id: string | null;
}

export default function PaymentMethodsSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Check for tokenization result in URL params
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tokenizeStatus = params.get('tokenize');
    const bepaidSubStatus = params.get('bepaid_sub');
    
    // PATCH-4: Handle pending cancel after successful provider subscription creation
    const pendingCancel = sessionStorage.getItem('pending_cancel_provider_sub');
    if (bepaidSubStatus === 'success' && pendingCancel) {
      // Cancel the old provider subscription after new one was successfully created
      supabase.functions.invoke('bepaid-cancel-subscriptions', {
        body: { subscription_ids: [pendingCancel], source: 'user_card_change' }
      }).then(() => {
        sessionStorage.removeItem('pending_cancel_provider_sub');
        queryClient.invalidateQueries({ queryKey: ['user-provider-subscriptions'] });
        toast.success('Карта успешно изменена');
      }).catch((err) => {
        console.error('Failed to cancel old provider subscription:', err);
        sessionStorage.removeItem('pending_cancel_provider_sub');
      });
      navigate(location.pathname, { replace: true });
      return;
    } else if (bepaidSubStatus === 'success') {
      toast.success('Подписка активирована');
      queryClient.invalidateQueries({ queryKey: ['user-provider-subscriptions'] });
      navigate(location.pathname, { replace: true });
      return;
    } else if (bepaidSubStatus === 'failed') {
      toast.error('Не удалось оформить подписку');
      navigate(location.pathname, { replace: true });
      return;
    }
    
    if (tokenizeStatus === 'rejected') {
      const reason = params.get('reason');
      if (reason === 'virtual_card_not_allowed') {
        toast.error('Виртуальные карты не принимаются для рассрочки. Используйте физическую банковскую карту.');
      } else {
        toast.error('Карта отклонена. Попробуйте другую карту.');
      }
      navigate(location.pathname, { replace: true });
    } else if (tokenizeStatus === 'success') {
      // Card added successfully - check for autolink result in newest card's meta
      const checkAutolinkResult = async () => {
        if (!user) return;
        
        const { data: newestCard } = await supabase
          .from('payment_methods')
          .select('meta')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        
        const meta = newestCard?.meta as Record<string, unknown> | null;
        const autolinkResult = meta?.autolink_result as { 
          updated_payments?: number; 
          updated_queue?: number; 
          status?: string;
          stop_reason?: string;
        } | undefined;
        
        if (autolinkResult) {
          const totalLinked = (autolinkResult.updated_payments || 0) + (autolinkResult.updated_queue || 0);
          
          if (autolinkResult.status === 'stop') {
            if (autolinkResult.stop_reason === 'card_collision_last4_brand') {
              toast.info('Карта добавлена. Автопривязка транзакций пропущена (карта используется несколькими контактами).', { duration: 6000 });
            } else if (autolinkResult.stop_reason === 'too_many_candidates') {
              toast.info('Карта добавлена. Слишком много совпадений — обратитесь в поддержку.', { duration: 6000 });
            }
          } else if (totalLinked > 0) {
            toast.success(`Карта добавлена. Привязано ${totalLinked} исторических транзакций.`, { duration: 5000 });
          } else {
            toast.success('Карта успешно добавлена');
          }
        } else {
          toast.success('Карта успешно добавлена');
        }
        
        queryClient.invalidateQueries({ queryKey: ['user-payment-methods'] });
      };
      
      checkAutolinkResult();
      navigate(location.pathname, { replace: true });
    }
  }, [location.search, navigate, location.pathname, user, queryClient]);

  // Check for pending installments - blocks card deletion
  const { data: pendingInstallments } = useUserPendingInstallments(user?.id);

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
        .select("id, status, payment_method_id, auto_renew")
        .eq("user_id", user.id)
        .in("status", ["active", "trial"]);
      
      if (error) throw error;
      return data as (Subscription & { auto_renew?: boolean })[];
    },
    enabled: !!user,
  });

  // PATCH-7: Fetch provider-managed subscriptions (bePaid)
  const { data: providerSubscriptions } = useQuery({
    queryKey: ["user-provider-subscriptions", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("provider_subscriptions")
        .select(`
          *,
          subscriptions_v2!inner (
            id, 
            product_id, 
            access_end_at,
            products_v2 (name)
          )
        `)
        .eq("user_id", user.id)
        .in("state", ["active", "trial", "pending"])
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // PATCH 9: Check for auto_renew subscriptions without payment method
  const hasAutoRenewWithoutCard = activeSubscriptions?.some(
    s => s.auto_renew === true && !s.payment_method_id
  );

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
      
      // Check for pending installments
      if (pendingInstallments && pendingInstallments.length > 0) {
        const totalPending = pendingInstallments.reduce((sum, i) => sum + Number(i.amount), 0);
        throw new Error(`Невозможно отвязать карту: есть активная рассрочка (${pendingInstallments.length} платежей на сумму ${(totalPending / 100).toFixed(2)} BYN)`);
      }
      
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

      // Log the action
      await supabase.from("audit_logs").insert({
        actor_user_id: user.id,
        action: "payment_method.removed",
        meta: { 
          payment_method_id: methodId,
          brand: method?.brand, 
          last4: method?.last4 
        },
      });
    },
    onSuccess: () => {
      // Инвалидируем карты и подписки (триггер обновил их в БД)
      queryClient.invalidateQueries({ queryKey: ["user-payment-methods"] });
      queryClient.invalidateQueries({ queryKey: ["user-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["user-active-subscriptions"] });
      
      toast.success("Карта отвязана", {
        description: "Автоматическое продление подписок отключено. Привяжите новую карту для возобновления.",
        duration: 6000,
      });
      setDeletingId(null);
    },
    onError: (error) => {
      toast.error(error.message);
      setDeletingId(null);
    },
  });

  // PATCH D: Re-verify card mutation
  const reverifyMutation = useMutation({
    mutationFn: async (methodId: string) => {
      if (!user) throw new Error("Не авторизован");
      
      // Guard: check if there's already an active job for this card
      const { data: existingJob } = await supabase
        .from('payment_method_verification_jobs')
        .select('id, status')
        .eq('payment_method_id', methodId)
        .in('status', ['pending', 'processing', 'rate_limited'])
        .maybeSingle();
      
      if (existingJob) {
        throw new Error("Карта уже в очереди на проверку");
      }
      
      // Create new verification job
      const idempotencyKey = `reverify_${methodId}_${Date.now()}`;
      const { error } = await supabase
        .from('payment_method_verification_jobs')
        .insert({
          payment_method_id: methodId,
          user_id: user.id,
          status: 'pending',
          attempt_count: 0,
          max_attempts: 3,
          idempotency_key: idempotencyKey,
        });
      
      if (error) throw error;
      
      // Update card status to pending
      await supabase
        .from('payment_methods')
        .update({ verification_status: 'pending' })
        .eq('id', methodId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-payment-methods'] });
      toast.success('Карта поставлена в очередь на проверку');
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // PATCH-7: Cancel provider subscription mutation
  const cancelProviderSubMutation = useMutation({
    mutationFn: async (providerSubId: string) => {
      const { data, error } = await supabase.functions.invoke('bepaid-cancel-subscriptions', {
        body: { subscription_ids: [providerSubId], source: 'user_self_cancel' }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-provider-subscriptions'] });
      toast.success('Подписка отменена');
    },
    onError: (error: Error) => {
      toast.error('Ошибка: ' + error.message);
    },
  });

  // PATCH-4: Change card for provider subscription - SAFE FLOW
  // Create new subscription FIRST, cancel old AFTER successful return
  const handleChangeProviderCard = async (providerSubId: string, subscriptionV2Id: string) => {
    try {
      // 1. FIRST create new provider subscription (redirect)
      const { data, error } = await supabase.functions.invoke('bepaid-create-subscription', {
        body: { subscription_v2_id: subscriptionV2Id }
      });
      
      if (error) throw error;
      
      if (data?.redirect_url) {
        // 2. Save old subscription ID for cancellation AFTER successful return
        sessionStorage.setItem('pending_cancel_provider_sub', providerSubId);
        window.location.href = data.redirect_url;
      } else {
        toast.error('Не удалось создать сессию подписки');
      }
    } catch (error: any) {
      toast.error('Ошибка: ' + error.message);
    }
  };

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

  // Check: active subscriptions but no linked cards
  const hasActiveSubsWithoutCard = 
    activeSubscriptions && 
    activeSubscriptions.length > 0 && 
    (!paymentMethods || paymentMethods.length === 0);

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Оплата и карты</h1>
          <p className="text-muted-foreground">Управление способами оплаты</p>
        </div>

        {/* Price Protection Alert - original */}
        {hasActiveSubsWithoutCard && (
          <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <AlertTitle className="text-amber-800 dark:text-amber-200">
              Ваша цена заблокирована
            </AlertTitle>
            <AlertDescription className="text-amber-700 dark:text-amber-300">
              Сейчас вы пользуетесь клубом по специальной стоимости. 
              Чтобы сохранить эти условия и избежать повышения цены при следующем продлении, 
              пожалуйста, привяжите карту для автоматического списания.
            </AlertDescription>
          </Alert>
        )}

        {/* PATCH 9: Alert for auto_renew subscriptions without payment method */}
        {hasAutoRenewWithoutCard && !hasActiveSubsWithoutCard && (
          <Alert className="border-destructive/50 bg-destructive/5">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <AlertTitle className="text-destructive">
              Привяжите карту для автопродления
            </AlertTitle>
            <AlertDescription className="text-muted-foreground">
              У вас есть активная подписка с автопродлением, но карта не привязана.
              Без карты доступ не продлится автоматически и потребуется ручная оплата.
            </AlertDescription>
            <Button 
              onClick={handleAddCard} 
              className="mt-3 gap-2"
              variant="default"
            >
              <CreditCard className="h-4 w-4" />
              Привязать карту сейчас
            </Button>
          </Alert>
        )}

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
                            {/* Verification status badges */}
                            {method.verification_status === 'pending' && (
                              <Badge variant="outline" className="gap-1 text-amber-600 border-amber-600">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Проверяем...
                              </Badge>
                            )}
                            {method.verification_status === 'verified' && (
                              <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
                                <Check className="h-3 w-3" />
                                Для автоплатежей
                              </Badge>
                            )}
                            {method.verification_status === 'rejected' && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="destructive" className="gap-1 cursor-help">
                                      <AlertTriangle className="h-3 w-3" />
                                      Не для автоплатежей
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-xs">
                                    <p>{method.verification_error || 'Карта требует 3D-Secure на каждую операцию'}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                            {method.verification_status === 'failed' && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="secondary" className="gap-1 cursor-help">
                                      <AlertCircle className="h-3 w-3" />
                                      Не удалось проверить
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-xs">
                                    <p>{method.verification_error || 'Ошибка проверки карты'}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Действует до: {formatExpiry(method.exp_month, method.exp_year)}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {/* PATCH D: Re-verify button for rejected/failed cards */}
                        {(method.verification_status === 'rejected' || method.verification_status === 'failed') && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => reverifyMutation.mutate(method.id)}
                            disabled={reverifyMutation.isPending}
                            className="gap-1"
                          >
                            {reverifyMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                            Перепроверить
                          </Button>
                        )}
                        
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

        {/* PATCH-7: Provider-managed subscriptions (bePaid) */}
        {providerSubscriptions && providerSubscriptions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Подписки с автопродлением
              </CardTitle>
              <CardDescription>
                Автоматическое списание каждые 30 дней через платёжную систему
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {providerSubscriptions.map((sub: any) => {
                const productName = sub.subscriptions_v2?.products_v2?.name || 'Подписка';
                const accessEnd = sub.subscriptions_v2?.access_end_at;
                const subscriptionV2Id = sub.subscriptions_v2?.id;
                
                return (
                  <div key={sub.id} className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                    <div className="flex items-center gap-4">
                      <RefreshCw className="h-8 w-8 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{productName}</p>
                        <p className="text-sm text-muted-foreground">
                          {sub.card_brand?.toUpperCase() || 'Карта'} •••• {sub.card_last4 || '****'}
                        </p>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                          <Calendar className="h-3 w-3" />
                          <span>
                            Следующее списание: {sub.next_charge_at 
                              ? format(new Date(sub.next_charge_at), "dd.MM.yyyy", { locale: ru }) 
                              : '—'} — {((sub.amount_cents || 0) / 100).toFixed(2)} {sub.currency || 'BYN'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleChangeProviderCard(sub.provider_subscription_id, subscriptionV2Id)}
                        disabled={cancelProviderSubMutation.isPending}
                      >
                        Изменить карту
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button 
                            variant="destructive" 
                            size="sm"
                            disabled={cancelProviderSubMutation.isPending}
                          >
                            {cancelProviderSubMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              'Отменить'
                            )}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Отменить подписку?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Автоматическое продление будет отключено. 
                              Доступ сохранится до {accessEnd 
                                ? format(new Date(accessEnd), "dd MMMM yyyy", { locale: ru })
                                : 'окончания периода'}.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Назад</AlertDialogCancel>
                            <AlertDialogAction 
                              onClick={() => cancelProviderSubMutation.mutate(sub.provider_subscription_id)}
                            >
                              Отменить подписку
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

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