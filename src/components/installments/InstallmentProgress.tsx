import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Check, Clock, AlertTriangle, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InstallmentPayment } from "@/hooks/useInstallments";

interface InstallmentProgressProps {
  installments: InstallmentPayment[];
  currency?: string;
  showDetails?: boolean;
}

export function InstallmentProgress({ 
  installments, 
  currency = "BYN",
  showDetails = true 
}: InstallmentProgressProps) {
  if (!installments.length) return null;

  const paidCount = installments.filter(i => i.status === "succeeded").length;
  const pendingCount = installments.filter(i => i.status === "pending").length;
  const failedCount = installments.filter(i => i.status === "failed").length;
  const totalCount = installments.length;

  const paidAmount = installments
    .filter(i => i.status === "succeeded")
    .reduce((sum, i) => sum + Number(i.amount), 0);
  
  const totalAmount = installments.reduce((sum, i) => sum + Number(i.amount), 0);
  const remainingAmount = totalAmount - paidAmount;

  const progressPercent = (paidCount / totalCount) * 100;
  const isComplete = paidCount === totalCount;

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  return (
    <div className="space-y-3">
      {/* Progress bar with milestones */}
      <div className="relative">
        <Progress 
          value={progressPercent} 
          className={cn(
            "h-3",
            isComplete && "bg-green-500/20"
          )}
        />
        
        {/* Milestone dots */}
        <div className="absolute inset-0 flex items-center justify-between px-0.5">
          {installments.map((installment, index) => {
            const position = ((index + 1) / totalCount) * 100;
            const isPaid = installment.status === "succeeded";
            const isFailed = installment.status === "failed";
            
            return (
              <div
                key={installment.id}
                className={cn(
                  "w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all",
                  "absolute top-1/2 -translate-y-1/2",
                  isPaid ? "bg-green-500 border-green-500 text-white" :
                  isFailed ? "bg-destructive border-destructive text-white" :
                  "bg-background border-muted-foreground/30"
                )}
                style={{ left: `calc(${position}% - 8px)` }}
              >
                {isPaid && <Check className="h-2.5 w-2.5" />}
                {isFailed && <AlertTriangle className="h-2.5 w-2.5" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Stats row */}
      {showDetails && (
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
              <span className="text-muted-foreground">Оплачено:</span>
              <span className="font-medium text-green-600 dark:text-green-400">
                {paidCount}/{totalCount}
              </span>
            </div>
            
            {pendingCount > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-muted-foreground">Ожидает:</span>
                <span className="font-medium">{pendingCount}</span>
              </div>
            )}
            
            {failedCount > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-destructive" />
                <span className="text-muted-foreground">Ошибка:</span>
                <span className="font-medium text-destructive">{failedCount}</span>
              </div>
            )}
          </div>

          <div className="text-right">
            <span className="text-muted-foreground">Оплачено: </span>
            <span className="font-semibold text-green-600 dark:text-green-400">
              {formatAmount(paidAmount)} {currency}
            </span>
            <span className="text-muted-foreground mx-1">/</span>
            <span className="font-medium">
              {formatAmount(totalAmount)} {currency}
            </span>
          </div>
        </div>
      )}

      {/* Compact summary badges */}
      {!showDetails && (
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1 text-green-600 border-green-500/30 bg-green-500/10">
            <Check className="h-3 w-3" />
            {paidCount}/{totalCount}
          </Badge>
          
          {remainingAmount > 0 && (
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />
              {formatAmount(remainingAmount)} {currency}
            </Badge>
          )}
          
          {isComplete && (
            <Badge className="bg-green-500 text-white">
              Полностью оплачено
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
