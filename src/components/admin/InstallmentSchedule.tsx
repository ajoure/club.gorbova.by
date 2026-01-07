import { format, isPast } from "date-fns";
import { ru } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Check, Clock, AlertTriangle, X, Zap, XCircle, Loader2 } from "lucide-react";
import {
  useSubscriptionInstallments,
  useChargeInstallment,
  useCloseInstallmentPlan,
  type InstallmentPayment,
} from "@/hooks/useInstallments";

interface InstallmentScheduleProps {
  subscriptionId: string;
  currency?: string;
}

const statusConfig: Record<string, { icon: React.ReactNode; label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  succeeded: { icon: <Check className="h-3 w-3" />, label: "Оплачен", variant: "default" },
  pending: { icon: <Clock className="h-3 w-3" />, label: "Ожидает", variant: "secondary" },
  processing: { icon: <Loader2 className="h-3 w-3 animate-spin" />, label: "Обработка", variant: "outline" },
  failed: { icon: <AlertTriangle className="h-3 w-3" />, label: "Ошибка", variant: "destructive" },
  cancelled: { icon: <X className="h-3 w-3" />, label: "Отменён", variant: "outline" },
  skipped: { icon: <X className="h-3 w-3" />, label: "Пропущен", variant: "outline" },
};

export function InstallmentSchedule({ subscriptionId, currency = "BYN" }: InstallmentScheduleProps) {
  const { data: installments, isLoading } = useSubscriptionInstallments(subscriptionId);
  const chargeInstallment = useChargeInstallment();
  const closeInstallmentPlan = useCloseInstallmentPlan();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (!installments || installments.length === 0) {
    return null;
  }

  const paidInstallments = installments.filter(i => i.status === "succeeded");
  const pendingInstallments = installments.filter(i => i.status === "pending");
  const totalPaid = paidInstallments.reduce((sum, i) => sum + Number(i.amount), 0);
  const totalPending = pendingInstallments.reduce((sum, i) => sum + Number(i.amount), 0);
  const nextPending = pendingInstallments[0];

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount / 100);
  };

  const isOverdue = (installment: InstallmentPayment) => {
    return installment.status === "pending" && isPast(new Date(installment.due_date));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium flex items-center gap-2">
          <Clock className="h-4 w-4" />
          График платежей (рассрочка)
        </h4>
        <Badge variant="outline">
          {paidInstallments.length}/{installments.length} оплачено
        </Badge>
      </div>

      {/* Installment list */}
      <div className="space-y-2">
        {installments.map((installment) => {
          const config = statusConfig[installment.status] || statusConfig.pending;
          const overdue = isOverdue(installment);

          return (
            <div
              key={installment.id}
              className={`flex items-center justify-between p-3 rounded-lg border ${
                overdue ? "border-destructive/50 bg-destructive/5" : "bg-muted/30"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`p-1.5 rounded-full ${
                  installment.status === "succeeded" ? "bg-green-500/20 text-green-600" :
                  overdue ? "bg-destructive/20 text-destructive" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {config.icon}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {installment.payment_number}/{installment.total_payments}
                    </span>
                    <span className="text-muted-foreground">—</span>
                    <span className="font-medium">
                      {formatAmount(Number(installment.amount))} {currency}
                    </span>
                    {overdue && (
                      <Badge variant="destructive" className="text-xs">
                        Просрочен
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {installment.paid_at
                      ? `Оплачен ${format(new Date(installment.paid_at), "d MMM yyyy", { locale: ru })}`
                      : format(new Date(installment.due_date), "d MMMM yyyy", { locale: ru })}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant={config.variant} className="gap-1">
                  {config.icon}
                  {config.label}
                </Badge>

                {installment.status === "pending" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => chargeInstallment.mutate(installment.id)}
                    disabled={chargeInstallment.isPending}
                  >
                    {chargeInstallment.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Zap className="h-3 w-3" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Separator />

      {/* Summary */}
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Оплачено:</span>
        <span className="font-medium text-green-600">
          {formatAmount(totalPaid)} {currency}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Остаток:</span>
        <span className="font-medium">
          {formatAmount(totalPending)} {currency}
        </span>
      </div>

      {/* Actions */}
      {pendingInstallments.length > 0 && (
        <div className="flex gap-2">
          {nextPending && (
            <Button
              className="flex-1"
              onClick={() => chargeInstallment.mutate(nextPending.id)}
              disabled={chargeInstallment.isPending}
            >
              {chargeInstallment.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              Списать платёж #{nextPending.payment_number}
            </Button>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="gap-1">
                <XCircle className="h-4 w-4" />
                Закрыть
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Закрыть рассрочку досрочно?</AlertDialogTitle>
                <AlertDialogDescription>
                  Все оставшиеся платежи ({pendingInstallments.length}) будут отменены.
                  Остаток к оплате: {formatAmount(totalPending)} {currency}.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => closeInstallmentPlan.mutate({ subscriptionId })}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Закрыть рассрочку
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
