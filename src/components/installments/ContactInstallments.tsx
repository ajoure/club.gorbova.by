import { useState } from "react";
import { format, isPast } from "date-fns";
import { ru } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { 
  CreditCard, 
  ChevronDown, 
  ChevronRight,
  Clock,
  AlertTriangle,
  Check,
  Zap,
  Bell,
  XCircle,
  Loader2,
  Package,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { InstallmentProgress } from "./InstallmentProgress";
import { InstallmentTimeline } from "./InstallmentTimeline";
import { useChargeInstallment, useCloseInstallmentPlan } from "@/hooks/useInstallments";
import type { InstallmentPayment } from "@/hooks/useInstallments";

interface ContactInstallmentsProps {
  userId: string;
  currency?: string;
}

interface InstallmentPlan {
  subscriptionId: string;
  orderId: string;
  productName: string;
  tariffName: string;
  installments: InstallmentPayment[];
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  isComplete: boolean;
  hasOverdue: boolean;
}

export function ContactInstallments({ userId, currency = "BYN" }: ContactInstallmentsProps) {
  const queryClient = useQueryClient();
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set());
  const chargeInstallment = useChargeInstallment();
  const closeInstallmentPlan = useCloseInstallmentPlan();

  // Fetch all installments for this user
  const { data: installments, isLoading } = useQuery({
    queryKey: ["user-all-installments", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("installment_payments")
        .select(`
          *,
          subscriptions_v2 (
            id, status,
            products_v2 ( id, name ),
            tariffs ( id, name )
          )
        `)
        .eq("user_id", userId)
        .order("due_date", { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!userId,
  });

  // Send reminder mutation
  const sendReminderMutation = useMutation({
    mutationFn: async (installmentId: string) => {
      const { data, error } = await supabase.functions.invoke("installment-notifications", {
        body: { action: "upcoming", installment_id: installmentId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Напоминание отправлено");
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  const togglePlan = (subscriptionId: string) => {
    setExpandedPlans(prev => {
      const next = new Set(prev);
      if (next.has(subscriptionId)) {
        next.delete(subscriptionId);
      } else {
        next.add(subscriptionId);
      }
      return next;
    });
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!installments?.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <CreditCard className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>Нет рассрочек</p>
      </div>
    );
  }

  // Group installments by subscription
  const planMap = new Map<string, InstallmentPlan>();
  
  installments.forEach(installment => {
    const subId = installment.subscription_id;
    const sub = installment.subscriptions_v2 as any;
    
    if (!planMap.has(subId)) {
      planMap.set(subId, {
        subscriptionId: subId,
        orderId: installment.order_id,
        productName: sub?.products_v2?.name || "Продукт",
        tariffName: sub?.tariffs?.name || "Тариф",
        installments: [],
        totalAmount: 0,
        paidAmount: 0,
        pendingAmount: 0,
        isComplete: false,
        hasOverdue: false,
      });
    }
    
    const plan = planMap.get(subId)!;
    plan.installments.push(installment as unknown as InstallmentPayment);
    plan.totalAmount += Number(installment.amount);
    
    if (installment.status === "succeeded") {
      plan.paidAmount += Number(installment.amount);
    } else if (installment.status === "pending") {
      plan.pendingAmount += Number(installment.amount);
      if (isPast(new Date(installment.due_date))) {
        plan.hasOverdue = true;
      }
    }
  });

  // Calculate completion status
  planMap.forEach(plan => {
    plan.isComplete = plan.installments.every(i => i.status === "succeeded");
  });

  const plans = Array.from(planMap.values());
  const activePlans = plans.filter(p => !p.isComplete);
  const completedPlans = plans.filter(p => p.isComplete);
  const hasOverduePlans = plans.some(p => p.hasOverdue);

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Рассрочки</h3>
          <Badge variant="outline">{plans.length}</Badge>
        </div>
        {hasOverduePlans && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            Есть просроченные
          </Badge>
        )}
      </div>

      {/* Active plans */}
      {activePlans.map(plan => (
        <Card 
          key={plan.subscriptionId}
          className={cn(
            "overflow-hidden transition-all",
            plan.hasOverdue && "border-destructive/50"
          )}
        >
          <Collapsible
            open={expandedPlans.has(plan.subscriptionId)}
            onOpenChange={() => togglePlan(plan.subscriptionId)}
          >
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center",
                      plan.hasOverdue ? "bg-destructive/10" : "bg-primary/10"
                    )}>
                      <Package className={cn(
                        "h-5 w-5",
                        plan.hasOverdue ? "text-destructive" : "text-primary"
                      )} />
                    </div>
                    <div>
                      <CardTitle className="text-base">{plan.productName}</CardTitle>
                      <p className="text-sm text-muted-foreground">{plan.tariffName}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {plan.hasOverdue && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Просрочено
                      </Badge>
                    )}
                    <div className="text-right">
                      <p className="font-semibold">{formatAmount(plan.paidAmount)} / {formatAmount(plan.totalAmount)}</p>
                      <p className="text-xs text-muted-foreground">{currency}</p>
                    </div>
                    {expandedPlans.has(plan.subscriptionId) ? (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                </div>
                
                <div className="mt-3">
                  <InstallmentProgress 
                    installments={plan.installments} 
                    currency={currency}
                    showDetails={false}
                  />
                </div>
              </CardHeader>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <CardContent className="pt-0">
                <Separator className="mb-4" />
                
                <InstallmentTimeline
                  installments={plan.installments}
                  currency={currency}
                  onCharge={(id) => chargeInstallment.mutate(id)}
                  isCharging={chargeInstallment.isPending}
                />

                {/* Actions */}
                <div className="flex gap-2 mt-4 pt-4 border-t">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1.5">
                        <XCircle className="h-4 w-4" />
                        Закрыть рассрочку
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Закрыть рассрочку досрочно?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Все оставшиеся платежи будут отменены. Остаток к оплате: {formatAmount(plan.pendingAmount)} {currency}.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Отмена</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => closeInstallmentPlan.mutate({ subscriptionId: plan.subscriptionId })}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Закрыть рассрочку
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      ))}

      {/* Completed plans */}
      {completedPlans.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Check className="h-4 w-4 text-green-500" />
            Завершённые рассрочки ({completedPlans.length})
          </p>
          
          {completedPlans.map(plan => (
            <Card key={plan.subscriptionId} className="bg-green-500/5 border-green-500/20">
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Check className="h-5 w-5 text-green-500" />
                    <div>
                      <p className="font-medium">{plan.productName}</p>
                      <p className="text-xs text-muted-foreground">{plan.tariffName}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-green-600 dark:text-green-400">
                      {formatAmount(plan.totalAmount)} {currency}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {plan.installments.length} платежей
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
