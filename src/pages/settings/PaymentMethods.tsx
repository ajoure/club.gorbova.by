import { useState, useEffect, useMemo } from "react";
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
import { CreditCard, Plus, Star, Trash2, AlertTriangle, Check, Loader2, RefreshCw, Calendar, Shield, Clock, ShieldCheck } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";

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
  billing_type?: string | null;
  auto_renew?: boolean;
  access_end_at?: string | null;
  product_id?: string | null;
  products_v2?: { name: string; code: string } | null;
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
        console.error('Failed to cancel old provider subscription', {
          message: err?.message,
          name: err?.name,
        });
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
      // Card added — show autolink result if any. No verification polling
      // (recurring verification is disabled; cards are usable immediately).
      const handleAutolinkResult = async () => {
        if (!user) return;

        const { data: newestCard } = await supabase
          .from('payment_methods')
          .select('id, meta')
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
            } else {
              toast.success('Карта успешно привязана');
            }
          } else if (totalLinked > 0) {
            toast.success(`Карта добавлена. Привязано ${totalLinked} исторических транзакций.`, { duration: 5000 });
          } else {
            toast.success('Карта успешно привязана');
          }
        } else {
          toast.success('Карта успешно привязана');
        }

        queryClient.invalidateQueries({ queryKey: ['user-payment-methods'] });
      };

      handleAutolinkResult();
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

  // PATCH-C: Expand query to include product info and access_end_at
  const { data: activeSubscriptions } = useQuery({
    queryKey: ["user-active-subscriptions", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("subscriptions_v2")
        .select(`
          id, status, payment_method_id, auto_renew, billing_type, access_end_at, product_id,
          products_v2(name, code)
        `)
        .eq("user_id", user.id)
        .in("status", ["active", "trial"]);
      
      if (error) throw error;
      return data as Subscription[];
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
        .in("state", ["active", "trial"])
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

  // Eligible subscriptions for provider-managed billing (not already provider-managed)
  const eligibleForProviderSub = useMemo(() => {
    if (!activeSubscriptions || !providerSubscriptions) return [];
    
    // Get subscription IDs that already have active provider subscriptions
    const providerLinkedSubIds = new Set(
      providerSubscriptions
        ?.filter((ps: any) => ['active', 'trial', 'pending'].includes(ps.state))
        ?.map((ps: any) => ps.subscriptions_v2?.id) || []
    );
    
    // Return active subscriptions that are NOT provider-managed
    return activeSubscriptions.filter(
      sub => (sub.status === 'active' || sub.status === 'trial') && 
             !providerLinkedSubIds.has(sub.id) &&
             sub.billing_type !== 'provider_managed'
    );
  }, [activeSubscriptions, providerSubscriptions]);

  const hasEligibleSubs = eligibleForProviderSub && eligibleForProviderSub.length > 0;

  // Create provider subscription function - per-subscription loading state
  const [creatingSubId, setCreatingSubId] = useState<string | null>(null);
  const handleCreateProviderSubscription = async (subscriptionV2Id: string) => {
    try {
      setCreatingSubId(subscriptionV2Id);
      const { data, error } = await supabase.functions.invoke('bepaid-create-subscription', {
        body: {
          subscription_v2_id: subscriptionV2Id,
          return_url: window.location.href,
          explicit_user_choice: true,
        }
      });

      if (error) throw error;

      if (data?.redirect_url) {
        window.location.href = data.redirect_url;
      } else {
        toast.error('Не удалось создать сессию подписки');
        setCreatingSubId(null);
      }
    } catch (error: any) {
      toast.error(normalizeEdgeFunctionError(error, error?.context?.body));
      setCreatingSubId(null);
    }
  };


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
    onError: (error: any) => {
      toast.error(normalizeEdgeFunctionError(error, error?.context?.body));
      setDeletingId(null);
    },
  });

  // Re-verify mutation removed: payment-method-verify-recurring is disabled (HTTP 410).
  // No verification jobs are created from the UI anymore.

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
    onError: (error: any) => {
      toast.error(normalizeEdgeFunctionError(error, error?.context?.body));
    },
  });

  // PATCH-4: Change card for provider subscription - SAFE FLOW
  // Create new subscription FIRST, cancel old AFTER successful return
  const handleChangeProviderCard = async (providerSubId: string, subscriptionV2Id: string) => {
    try {
      // 1. FIRST create new provider subscription (redirect)
      const { data, error } = await supabase.functions.invoke('bepaid-create-subscription', {
        body: { 
          subscription_v2_id: subscriptionV2Id,
          // PATCH-4: Explicit user choice guard
          explicit_user_choice: true,
        }
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
      toast.error(normalizeEdgeFunctionError(error, error?.context?.body));
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
      toast.error(normalizeEdgeFunctionError(error, error?.context?.body));
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
        {/* MIT pressure alert removed — no "price locked" warnings */}

        {/* PATCH 9: Alert for auto_renew subscriptions without payment method */}
        {/* MIT pressure alert removed — no "link card for auto-renewal" warnings */}

        {/* PATCH-C: Billing Method Choice - show each eligible subscription separately */}
        {hasEligibleSubs && (!paymentMethods || paymentMethods.length === 0) && (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Настройка автопродления
              </CardTitle>
              <CardDescription>
                Выберите удобный способ автоматического списания для каждой подписки
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {eligibleForProviderSub.map((sub) => {
                const productName = sub.products_v2?.name || 'Подписка';
                const accessEndDate = sub.access_end_at 
                  ? format(new Date(sub.access_end_at), "dd.MM.yy", { locale: ru })
                  : null;
                
                return (
                  <div key={sub.id} className="border rounded-lg p-4 bg-background">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="font-medium">{productName}</h4>
                        {accessEndDate && (
                          <p className="text-sm text-muted-foreground">
                            Доступ до {accessEndDate}
                          </p>
                        )}
                      </div>
                      {sub.status === 'trial' && (
                        <Badge variant="outline">Триал</Badge>
                      )}
                    </div>
                    
                    <div className="grid gap-3 sm:grid-cols-1">
                      {/* MIT option removed — only provider-managed (SBS) */}
                      
                      {/* Provider-managed Option */}
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                          <strong>bePaid подписка</strong> — работает с 3D-Secure (БЕЛКАРТ), списание каждые 30 дней
                        </p>
                        <Button 
                          variant="outline"
                          size="sm"
                          onClick={() => handleCreateProviderSubscription(sub.id)}
                          disabled={creatingSubId === sub.id}
                          className="w-full gap-2 border-blue-200 hover:bg-blue-50 dark:border-blue-800 dark:hover:bg-blue-900/20"
                        >
                          {creatingSubId === sub.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          Подключить bePaid
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
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
                  Сохранённые карты для удобной оплаты. Автоматическое списание возможно только в рамках активной подписки bePaid.
                </CardDescription>
              </div>
              <Button onClick={handleAddCard} className="gap-2">
                <Plus className="h-4 w-4" />
                Привязать карту
              </Button>
            </div>
            {/* PATCH PAYMENTS+REMINDERS v3 S5: явное разделение "сохранённая карта" vs "подписка". */}
            <Alert className="mt-3 border-muted-foreground/20 bg-muted/30">
              <Shield className="h-4 w-4" />
              <AlertDescription className="text-xs text-muted-foreground">
                Сохранённая карта — это удобство для будущих оплат. Сама по себе она не списывает деньги автоматически.
                Автопродление работает только через отдельную подписку bePaid (см. раздел «Настройка автопродления» выше или
                оформите её при следующей оплате).
              </AlertDescription>
            </Alert>
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
                      className={`p-4 rounded-lg border ${
                        expired ? "bg-destructive/5 border-destructive/30" : "bg-muted/30"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="text-muted-foreground">
                            {getCardIcon(method.brand)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
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
                              {/* Зелёные бейджи: карта пригодна для оплаты по умолчанию.
                                  «Готова для подписок» — только при явном positive verified-сигнале. */}
                              {!expired && (
                                <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
                                  <Check className="h-3 w-3" />
                                  Карта привязана
                                </Badge>
                              )}
                              {!expired && (
                                <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
                                  <Check className="h-3 w-3" />
                                  Можно использовать для оплаты
                                </Badge>
                              )}
                              {!expired && (method.verification_status === 'verified' || method.verification_status === 'verified_refund_pending') && (
                                <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
                                  <ShieldCheck className="h-3 w-3" />
                                  Готова для подписок
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Действует до: {formatExpiry(method.exp_month, method.exp_year)}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {/* «Перепроверить» удалено: payment-method-verify-recurring отключена. */}

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
                      
                      {/* PATCH-D: Warning only for rejected cards - NO CTA button here */}
                      {(method.verification_status === 'rejected' || method.verification_status === 'rejected_3ds_required') && (
                        <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                          <p className="text-sm text-amber-800 dark:text-amber-200">
                            ⚠️ Оплата этой картой может требовать 3D-Secure.
                          </p>
                        </div>
                      )}
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

        {/* PATCH-4: Provider-managed subscriptions (bePaid) with better UX */}
        {providerSubscriptions && providerSubscriptions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Подписки bePaid (каждые 30 дней)
              </CardTitle>
              <CardDescription className="space-y-1">
                <p>Автоматическое списание через платёжную систему bePaid</p>
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Списание ровно через 30 дней — даты платежей могут смещаться
                </p>
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
                      {/* PATCH-4: Tooltip explaining card change process */}
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => handleChangeProviderCard(sub.provider_subscription_id, subscriptionV2Id)}
                              disabled={cancelProviderSubMutation.isPending}
                            >
                              Изменить карту
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p>Будет создана новая подписка с другой картой.</p>
                            <p className="text-muted-foreground text-xs mt-1">
                              Неиспользованные дни добавятся к новому периоду.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
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