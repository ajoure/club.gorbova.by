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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { 
  CreditCard, 
  ChevronDown, 
  ChevronRight,
  Clock,
  AlertTriangle,
  Check,
  XCircle,
  Gift,
  Package,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { InstallmentProgress } from "./InstallmentProgress";
import { InstallmentTimeline } from "./InstallmentTimeline";
import { useChargeInstallment, useCloseInstallmentPlan, type CloseReason } from "@/hooks/useInstallments";
import type { InstallmentPayment } from "@/hooks/useInstallments";

interface ContactInstallmentsProps {
  userId: string;
  currency?: string;
  /** When true, empty state renders `null` instead of «Нет рассрочек»
   *  (used by ContactInstallmentsTabContent wrapper to avoid duplicate empty states). */
  hideEmptyState?: boolean;
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
  isClosed: boolean;
  closeReason: CloseReason | null;
  closeComment: string | null;
  closedAt: string | null;
  closedBy: string | null;
  closedByEmail: string | null;
}

export function ContactInstallments({ userId, currency = "BYN", hideEmptyState = false }: ContactInstallmentsProps) {
  const queryClient = useQueryClient();
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set());
  const [closeDialogOpen, setCloseDialogOpen] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState<CloseReason>("cancelled");
  const [closeComment, setCloseComment] = useState("");
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

  const handleClosePlan = (subscriptionId: string) => {
    closeInstallmentPlan.mutate(
      { subscriptionId, closeReason, comment: closeComment },
      {
        onSuccess: () => {
          setCloseDialogOpen(null);
          setCloseReason("cancelled");
          setCloseComment("");
        },
      }
    );
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
    if (hideEmptyState) return null;
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
    const meta = installment.meta as Record<string, any> | null;
    
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
        isClosed: false,
        closeReason: null,
        closeComment: null,
        closedAt: null,
        closedBy: null,
        closedByEmail: null,
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
    } else if (installment.status === "cancelled" || installment.status === "forgiven") {
      plan.isClosed = true;
      plan.closeReason = installment.status as CloseReason;
      // Support both old and new meta field names
      plan.closeComment = meta?.close_comment || meta?.cancelled_reason || null;
      plan.closedAt = meta?.closed_at || installment.updated_at || null;
      plan.closedBy = meta?.closed_by || null;
      plan.closedByEmail = meta?.closed_by_email || null;
    }
  });

  // Calculate completion status
  planMap.forEach(plan => {
    plan.isComplete = plan.installments.every(i => i.status === "succeeded");
  });

  const plans = Array.from(planMap.values());
  const activePlans = plans.filter(p => !p.isComplete && !p.isClosed);
  const completedPlans = plans.filter(p => p.isComplete);
  const closedPlans = plans.filter(p => p.isClosed);
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
                  <Dialog 
                    open={closeDialogOpen === plan.subscriptionId} 
                    onOpenChange={(open) => {
                      if (!open) {
                        setCloseDialogOpen(null);
                        setCloseReason("cancelled");
                        setCloseComment("");
                      }
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="gap-1.5"
                        onClick={() => setCloseDialogOpen(plan.subscriptionId)}
                      >
                        <XCircle className="h-4 w-4" />
                        Закрыть рассрочку
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Закрыть рассрочку</DialogTitle>
                        <DialogDescription>
                          Остаток к оплате: <span className="font-semibold">{formatAmount(plan.pendingAmount)} {currency}</span>
                        </DialogDescription>
                      </DialogHeader>
                      
                      <div className="space-y-4 py-4">
                        <div className="space-y-3">
                          <Label>Причина закрытия</Label>
                          <RadioGroup 
                            value={closeReason} 
                            onValueChange={(v) => setCloseReason(v as CloseReason)}
                          >
                            <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                              <RadioGroupItem value="cancelled" id="cancelled" className="mt-1" />
                              <div className="flex-1">
                                <Label htmlFor="cancelled" className="flex items-center gap-2 cursor-pointer font-medium">
                                  <XCircle className="h-4 w-4 text-muted-foreground" />
                                  Не оплачено
                                </Label>
                                <p className="text-sm text-muted-foreground mt-0.5">
                                  Клиент не выполнил обязательства по оплате
                                </p>
                              </div>
                            </div>
                            <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                              <RadioGroupItem value="forgiven" id="forgiven" className="mt-1" />
                              <div className="flex-1">
                                <Label htmlFor="forgiven" className="flex items-center gap-2 cursor-pointer font-medium">
                                  <Gift className="h-4 w-4 text-purple-500" />
                                  Прощено
                                </Label>
                                <p className="text-sm text-muted-foreground mt-0.5">
                                  Списываем остаток долга клиенту
                                </p>
                              </div>
                            </div>
                          </RadioGroup>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="comment">Комментарий (опционально)</Label>
                          <Textarea
                            id="comment"
                            placeholder="Причина закрытия рассрочки..."
                            value={closeComment}
                            onChange={(e) => setCloseComment(e.target.value)}
                            rows={3}
                          />
                        </div>
                      </div>

                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => setCloseDialogOpen(null)}
                        >
                          Отмена
                        </Button>
                        <Button
                          variant={closeReason === "forgiven" ? "default" : "destructive"}
                          onClick={() => handleClosePlan(plan.subscriptionId)}
                          disabled={closeInstallmentPlan.isPending}
                        >
                          {closeReason === "forgiven" ? (
                            <>
                              <Gift className="h-4 w-4 mr-1.5" />
                              Простить долг
                            </>
                          ) : (
                            <>
                              <XCircle className="h-4 w-4 mr-1.5" />
                              Закрыть рассрочку
                            </>
                          )}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
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

      {/* Closed plans */}
      {closedPlans.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <XCircle className="h-4 w-4 text-muted-foreground" />
            Закрытые рассрочки ({closedPlans.length})
          </p>
          
          {closedPlans.map(plan => {
            const isForgiven = plan.closeReason === "forgiven";
            const cancelledAmount = plan.installments
              .filter(i => i.status === "cancelled" || i.status === "forgiven")
              .reduce((sum, i) => sum + Number(i.amount), 0);
            
            return (
              <Card 
                key={plan.subscriptionId} 
                className={cn(
                  "overflow-hidden",
                  isForgiven 
                    ? "bg-purple-500/5 border-purple-500/20" 
                    : "bg-muted/30 border-muted"
                )}
              >
                <Collapsible
                  open={expandedPlans.has(plan.subscriptionId)}
                  onOpenChange={() => togglePlan(plan.subscriptionId)}
                >
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3 px-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          {isForgiven ? (
                            <Gift className="h-5 w-5 text-purple-500 mt-0.5" />
                          ) : (
                            <XCircle className="h-5 w-5 text-muted-foreground mt-0.5" />
                          )}
                          <div>
                            <p className="font-medium">{plan.productName}</p>
                            <p className="text-xs text-muted-foreground">{plan.tariffName}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge 
                                variant="outline" 
                                className={cn(
                                  "text-xs",
                                  isForgiven 
                                    ? "border-purple-500/30 text-purple-600 dark:text-purple-400" 
                                    : "text-muted-foreground"
                                )}
                              >
                                {isForgiven ? "Прощено" : "Не оплачено"} • {formatAmount(cancelledAmount)} {currency}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right">
                            <p className="text-sm">
                              Оплачено: <span className="font-semibold">{formatAmount(plan.paidAmount)}</span> / {formatAmount(plan.totalAmount)}
                            </p>
                            {plan.closedAt && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Закрыто: {format(new Date(plan.closedAt), "d MMM yyyy", { locale: ru })}
                              </p>
                            )}
                          </div>
                          {expandedPlans.has(plan.subscriptionId) ? (
                            <ChevronDown className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <CardContent className="pt-0 px-4 pb-4">
                      <Separator className="mb-4" />
                      
                      {/* Payment history */}
                      <div className="space-y-3">
                        <p className="text-sm font-medium text-muted-foreground">История платежей</p>
                        <InstallmentTimeline
                          installments={plan.installments}
                          currency={currency}
                          onCharge={() => {}}
                          isCharging={false}
                        />
                      </div>

                      {/* Closure details */}
                      <div className="mt-4 pt-4 border-t space-y-2">
                        <p className="text-sm font-medium text-muted-foreground">Информация о закрытии</p>
                        <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Статус:</span>
                            <Badge 
                              variant="outline" 
                              className={cn(
                                "gap-1",
                                isForgiven 
                                  ? "border-purple-500/30 text-purple-600 dark:text-purple-400" 
                                  : "text-muted-foreground"
                              )}
                            >
                              {isForgiven ? <Gift className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                              {isForgiven ? "Прощено" : "Не оплачено"}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Списано:</span>
                            <span className="font-medium">{formatAmount(cancelledAmount)} {currency}</span>
                          </div>
                          {plan.closedByEmail && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Закрыл:</span>
                              <span>{plan.closedByEmail}</span>
                            </div>
                          )}
                          {plan.closedAt && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Дата закрытия:</span>
                              <span>{format(new Date(plan.closedAt), "d MMMM yyyy, HH:mm", { locale: ru })}</span>
                            </div>
                          )}
                          {plan.closeComment && (
                            <div className="pt-2 border-t mt-2">
                              <p className="text-xs text-muted-foreground">Комментарий:</p>
                              <p className="text-sm italic mt-0.5">"{plan.closeComment}"</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}