import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Calendar, CreditCard, X, ChevronDown, History, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useActiveAccessRuleProducts, isCurrentValidAccess, isHistoricalAccess } from "@/hooks/useAccessValidation";

export function UserSubscriptions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedSubscription, setSelectedSubscription] = useState<any>(null);
  const [showFinished, setShowFinished] = useState(false);
  const { data: productsWithRules = new Set<string>() } = useActiveAccessRuleProducts();

  const { data: subscriptions, isLoading } = useQuery({
    queryKey: ["user-subscriptions", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from("subscriptions_v2")
        .select(`
          *,
          products_v2(id, name, code, is_active),
          tariffs(id, name, code, is_active)
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  // Fetch entitlements for order_based_only products
  const { data: entitlements, isLoading: entLoading } = useQuery({
    queryKey: ["user-entitlements", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("entitlements")
        .select(`
          id, user_id, product_id, product_code, status, expires_at, meta, order_id, created_at, updated_at,
          products_v2:product_id(id, name, code, is_active, entitlement_mode)
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  const cancelTrialMutation = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const { data, error } = await supabase.functions.invoke("cancel-trial", {
        body: { subscriptionId, reason: "user_request" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(data.message || "Trial отменен");
      queryClient.invalidateQueries({ queryKey: ["user-subscriptions"] });
      setCancelDialogOpen(false);
      setSelectedSubscription(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Ошибка отмены trial");
    },
  });

  const handleCancelTrial = (subscription: any) => {
    setSelectedSubscription(subscription);
    setCancelDialogOpen(true);
  };

  const confirmCancel = () => {
    if (selectedSubscription) {
      cancelTrialMutation.mutate(selectedSubscription.id);
    }
  };

  const getStatusBadge = (subscription: any) => {
    const status = subscription.status;
    const isExpired = subscription.access_end_at && new Date(subscription.access_end_at) < new Date();
    if (isExpired) {
      return <Badge variant="outline">Истекла</Badge>;
    }
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      active: "default",
      trial: "secondary",
      canceled: "destructive",
      expired: "outline",
      past_due: "destructive",
    };
    const labels: Record<string, string> = {
      active: "Активна",
      trial: "Пробный",
      canceled: "Отменена",
      expired: "Истекла",
      past_due: "Просрочена",
    };
    return (
      <Badge variant={variants[status] || "outline"}>
        {labels[status] || status}
      </Badge>
    );
  };

  // Split into active and finished
  const activeSubscriptions = subscriptions?.filter(s => 
    isCurrentValidAccess(s as any, productsWithRules)
  ) || [];

  const finishedSubscriptions = subscriptions?.filter(s => 
    isHistoricalAccess(s as any, productsWithRules)
  ) || [];

  // Entitlements for products NOT already covered by subscriptions
  const subscriptionProductIds = new Set(
    (subscriptions || []).map(s => s.product_id).filter(Boolean)
  );

  const activeEntitlements = (entitlements || []).filter(e => {
    if (!e.product_id || subscriptionProductIds.has(e.product_id)) return false;
    if (e.status !== 'active') return false;
    if (e.expires_at && new Date(e.expires_at) < new Date()) return false;
    const product = e.products_v2 as any;
    if (product?.is_active === false) return false;
    const productId = e.product_id;
    return productId && productsWithRules.has(productId);
  });

  const finishedEntitlements = (entitlements || []).filter(e => {
    if (!e.product_id || subscriptionProductIds.has(e.product_id)) return false;
    return !activeEntitlements.some(ae => ae.id === e.id);
  });

  const totalActive = activeSubscriptions.length + activeEntitlements.length;
  const totalFinished = finishedSubscriptions.length + finishedEntitlements.length;

  if (isLoading || entLoading) {
    return <div className="text-center py-8 text-muted-foreground">Загрузка...</div>;
  }

  if (!subscriptions?.length && !entitlements?.length) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          У вас нет активных подписок
        </CardContent>
      </Card>
    );
  }

  const renderSubscriptionCard = (subscription: any, compact = false) => (
    <Card key={subscription.id} className={compact ? "border-dashed opacity-60" : ""}>
      <CardHeader className={compact ? "pb-1 pt-3 px-4" : ""}>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className={compact ? "text-base" : "text-lg"}>
              {subscription.products_v2?.name || "Подписка"}
            </CardTitle>
            <CardDescription>
              Тариф: {subscription.tariffs?.name || "—"}
            </CardDescription>
          </div>
          {getStatusBadge(subscription)}
        </div>
      </CardHeader>
      <CardContent className={cn("space-y-4", compact && "pt-1 pb-3 px-4")}>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>
              Доступ до:{" "}
              {subscription.access_end_at
                ? format(new Date(subscription.access_end_at), "dd.MM.yyyy", { locale: ru })
                : "∞"}
            </span>
          </div>
          {subscription.next_charge_at && subscription.status !== "canceled" && !compact && (
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <span>
                Следующее списание:{" "}
                {format(new Date(subscription.next_charge_at), "dd.MM.yyyy", { locale: ru })}
              </span>
            </div>
          )}
        </div>

        {/* Trial info and cancel button — only for active */}
        {!compact && subscription.is_trial && subscription.status === "trial" && !subscription.trial_canceled_at && (
          <div className="border-t pt-4">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="text-muted-foreground">Trial до: </span>
                <span className="font-medium">
                  {subscription.trial_end_at
                    ? format(new Date(subscription.trial_end_at), "dd.MM.yyyy HH:mm", { locale: ru })
                    : "—"}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCancelTrial(subscription)}
                className="text-destructive hover:text-destructive"
              >
                <X className="h-4 w-4 mr-2" />
                Отменить автосписание
              </Button>
            </div>
          </div>
        )}

        {/* Trial canceled info */}
        {subscription.trial_canceled_at && (
          <div className="border-t pt-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              <span>
                Автосписание отменено{" "}
                {format(new Date(subscription.trial_canceled_at), "dd.MM.yyyy", { locale: ru })}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderEntitlementCard = (ent: any, compact = false) => {
    const product = ent.products_v2 as any;
    return (
      <Card key={ent.id} className={compact ? "border-dashed opacity-60" : ""}>
        <CardHeader className={compact ? "pb-1 pt-3 px-4" : ""}>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className={compact ? "text-base" : "text-lg"}>
                {product?.name || ent.product_code || "Продукт"}
              </CardTitle>
              <CardDescription className="flex items-center gap-1">
                <BookOpen className="h-3 w-3" />
                Доступ к продукту
              </CardDescription>
            </div>
            {ent.status === 'active' && !(ent.expires_at && new Date(ent.expires_at) < new Date())
              ? <Badge variant="default">Активен</Badge>
              : <Badge variant="outline">Истёк</Badge>
            }
          </div>
        </CardHeader>
        <CardContent className={cn("space-y-4", compact && "pt-1 pb-3 px-4")}>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>
                Доступ до:{" "}
                {ent.expires_at
                  ? format(new Date(ent.expires_at), "dd.MM.yyyy", { locale: ru })
                  : "∞"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <>
      <div className="space-y-4">
        {!totalActive && (
          <div className="text-center py-4 text-muted-foreground text-sm">
            Нет текущих активных подписок
          </div>
        )}
        {activeSubscriptions.map(sub => renderSubscriptionCard(sub))}
        {activeEntitlements.map(ent => renderEntitlementCard(ent))}

        {/* Finished toggle */}
        {totalFinished > 0 && (
          <div className="pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowFinished(!showFinished)}
              className="w-full gap-2 text-muted-foreground text-xs"
            >
              <History className="w-3.5 h-3.5" />
              {showFinished ? "Скрыть завершённые" : `Показать завершённые (${totalFinished})`}
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showFinished && "rotate-180")} />
            </Button>
            {showFinished && (
              <div className="space-y-3 mt-3">
                {finishedSubscriptions.map(sub => renderSubscriptionCard(sub, true))}
                {finishedEntitlements.map(ent => renderEntitlementCard(ent, true))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cancel Confirmation Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отменить автосписание?</DialogTitle>
            <DialogDescription>
              После отмены автоматическое списание не будет произведено.
              {selectedSubscription?.keep_access_until_trial_end !== false && (
                <span className="block mt-2">
                  Ваш доступ сохранится до конца пробного периода.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
              Назад
            </Button>
            <Button
              variant="destructive"
              onClick={confirmCancel}
              disabled={cancelTrialMutation.isPending}
            >
              {cancelTrialMutation.isPending ? "Отмена..." : "Отменить автосписание"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
