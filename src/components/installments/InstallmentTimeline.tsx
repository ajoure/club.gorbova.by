import { format, isPast, isFuture, differenceInDays } from "date-fns";
import { ru } from "date-fns/locale";
import { 
  Check, 
  Clock, 
  AlertTriangle, 
  X, 
  Loader2,
  CreditCard,
  Calendar,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { InstallmentPayment } from "@/hooks/useInstallments";

interface InstallmentTimelineProps {
  installments: InstallmentPayment[];
  currency?: string;
  onCharge?: (id: string) => void;
  isCharging?: boolean;
}

export function InstallmentTimeline({
  installments,
  currency = "BYN",
  onCharge,
  isCharging,
}: InstallmentTimelineProps) {
  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  if (!installments.length) return null;

  return (
    <div className="relative space-y-0">
      {/* Vertical line */}
      <div className="absolute left-4 top-6 bottom-6 w-0.5 bg-gradient-to-b from-green-500 via-muted-foreground/30 to-muted-foreground/10" />
      
      {installments.map((installment, index) => {
        const isFirst = index === 0;
        const isLast = index === installments.length - 1;
        const isPaid = installment.status === "succeeded";
        const isFailed = installment.status === "failed";
        const isPending = installment.status === "pending";
        const isProcessing = installment.status === "processing";
        const isOverdue = isPending && isPast(new Date(installment.due_date));
        const daysUntil = differenceInDays(new Date(installment.due_date), new Date());
        const isUpcoming = isPending && daysUntil >= 0 && daysUntil <= 3;

        return (
          <div key={installment.id} className="relative flex gap-4 pb-4 last:pb-0">
            {/* Timeline node */}
            <div className={cn(
              "relative z-10 flex items-center justify-center w-8 h-8 rounded-full border-2 flex-shrink-0",
              isPaid ? "bg-green-500 border-green-500 text-white" :
              isFailed ? "bg-destructive border-destructive text-white" :
              isProcessing ? "bg-blue-500 border-blue-500 text-white" :
              isOverdue ? "bg-destructive/10 border-destructive text-destructive" :
              isUpcoming ? "bg-amber-500/10 border-amber-500 text-amber-600" :
              "bg-background border-muted-foreground/30 text-muted-foreground"
            )}>
              {isPaid && <Check className="h-4 w-4" />}
              {isFailed && <AlertTriangle className="h-4 w-4" />}
              {isProcessing && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending && <span className="text-xs font-bold">{installment.payment_number}</span>}
            </div>

            {/* Content */}
            <div className={cn(
              "flex-1 rounded-lg border p-3 transition-all",
              isPaid ? "bg-green-500/5 border-green-500/20" :
              isFailed ? "bg-destructive/5 border-destructive/30" :
              isOverdue ? "bg-destructive/5 border-destructive/30" :
              isUpcoming ? "bg-amber-500/5 border-amber-500/30" :
              "bg-card border-border"
            )}>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">
                      {formatAmount(Number(installment.amount))} {currency}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {installment.payment_number}/{installment.total_payments}
                    </Badge>
                    {isOverdue && (
                      <Badge variant="destructive" className="text-xs">
                        Просрочен
                      </Badge>
                    )}
                    {isUpcoming && !isOverdue && (
                      <Badge className="text-xs bg-amber-500/20 text-amber-700 dark:text-amber-300">
                        {daysUntil === 0 ? "Сегодня" : `${daysUntil} дн.`}
                      </Badge>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {installment.paid_at ? (
                      <span className="text-green-600 dark:text-green-400">
                        Оплачен {format(new Date(installment.paid_at), "d MMMM yyyy 'в' HH:mm", { locale: ru })}
                      </span>
                    ) : (
                      <span className={isOverdue ? "text-destructive" : ""}>
                        {format(new Date(installment.due_date), "d MMMM yyyy", { locale: ru })}
                      </span>
                    )}
                  </div>

                  {installment.error_message && (
                    <div className="text-xs text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {installment.error_message}
                    </div>
                  )}
                </div>

                {isPending && onCharge && (
                  <Button
                    size="sm"
                    variant={isOverdue ? "destructive" : "outline"}
                    onClick={() => onCharge(installment.id)}
                    disabled={isCharging}
                    className="gap-1"
                  >
                    {isCharging ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <CreditCard className="h-3 w-3" />
                    )}
                    Списать
                  </Button>
                )}

                {isPaid && (
                  <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                    <Check className="h-4 w-4" />
                    <span className="text-xs font-medium">Оплачен</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
