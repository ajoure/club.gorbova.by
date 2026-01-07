import { format, isPast, differenceInDays } from "date-fns";
import { ru } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
  Check, 
  Clock, 
  AlertTriangle, 
  X, 
  Zap, 
  Loader2,
  CreditCard,
  Calendar,
  RefreshCw,
  Bell,
  BellOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { InstallmentPayment } from "@/hooks/useInstallments";

interface InstallmentCardProps {
  installment: InstallmentPayment;
  currency?: string;
  onCharge?: (id: string) => void;
  onSendReminder?: (id: string) => void;
  onSkip?: (id: string) => void;
  isCharging?: boolean;
  isSendingReminder?: boolean;
  compact?: boolean;
}

const statusConfig: Record<string, { 
  icon: React.ReactNode; 
  label: string; 
  bgColor: string;
  textColor: string;
  borderColor: string;
}> = {
  succeeded: { 
    icon: <Check className="h-3.5 w-3.5" />, 
    label: "Оплачен", 
    bgColor: "bg-green-500/10",
    textColor: "text-green-600 dark:text-green-400",
    borderColor: "border-green-500/20",
  },
  pending: { 
    icon: <Clock className="h-3.5 w-3.5" />, 
    label: "Ожидает", 
    bgColor: "bg-amber-500/10",
    textColor: "text-amber-600 dark:text-amber-400",
    borderColor: "border-amber-500/20",
  },
  processing: { 
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, 
    label: "Обработка", 
    bgColor: "bg-blue-500/10",
    textColor: "text-blue-600 dark:text-blue-400",
    borderColor: "border-blue-500/20",
  },
  failed: { 
    icon: <AlertTriangle className="h-3.5 w-3.5" />, 
    label: "Ошибка", 
    bgColor: "bg-red-500/10",
    textColor: "text-red-600 dark:text-red-400",
    borderColor: "border-red-500/20",
  },
  cancelled: { 
    icon: <X className="h-3.5 w-3.5" />, 
    label: "Отменён", 
    bgColor: "bg-muted",
    textColor: "text-muted-foreground",
    borderColor: "border-border",
  },
  skipped: { 
    icon: <X className="h-3.5 w-3.5" />, 
    label: "Пропущен", 
    bgColor: "bg-muted",
    textColor: "text-muted-foreground",
    borderColor: "border-border",
  },
};

export function InstallmentCard({
  installment,
  currency = "BYN",
  onCharge,
  onSendReminder,
  onSkip,
  isCharging,
  isSendingReminder,
  compact = false,
}: InstallmentCardProps) {
  const config = statusConfig[installment.status] || statusConfig.pending;
  const isOverdue = installment.status === "pending" && isPast(new Date(installment.due_date));
  const daysUntilDue = differenceInDays(new Date(installment.due_date), new Date());
  const isUpcoming = !isOverdue && daysUntilDue <= 3 && daysUntilDue >= 0;

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center justify-between p-3 rounded-lg border transition-colors",
          isOverdue ? "border-destructive/50 bg-destructive/5" : 
          isUpcoming ? "border-amber-500/50 bg-amber-500/5" :
          "bg-card border-border"
        )}
      >
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center",
            config.bgColor,
            config.textColor
          )}>
            {installment.status === "succeeded" ? (
              <Check className="h-4 w-4" />
            ) : (
              <span className="text-xs font-bold">{installment.payment_number}</span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">
                {formatAmount(Number(installment.amount))} {currency}
              </span>
              {isOverdue && (
                <Badge variant="destructive" className="text-[10px] h-4 px-1.5">
                  Просрочен
                </Badge>
              )}
              {isUpcoming && !isOverdue && (
                <Badge className="text-[10px] h-4 px-1.5 bg-amber-500/20 text-amber-700 dark:text-amber-300">
                  {daysUntilDue === 0 ? "Сегодня" : `${daysUntilDue} дн.`}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {installment.paid_at
                ? `Оплачен ${format(new Date(installment.paid_at), "d MMM", { locale: ru })}`
                : format(new Date(installment.due_date), "d MMMM yyyy", { locale: ru })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge 
            variant="outline" 
            className={cn("gap-1 text-xs", config.textColor, config.borderColor)}
          >
            {config.icon}
            {config.label}
          </Badge>

          {installment.status === "pending" && onCharge && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCharge(installment.id)}
              disabled={isCharging}
              className="h-7 px-2"
            >
              {isCharging ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Zap className="h-3 w-3" />
              )}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border p-4 transition-all duration-200",
        isOverdue ? "border-destructive/50 bg-gradient-to-br from-destructive/5 to-transparent" : 
        isUpcoming ? "border-amber-500/50 bg-gradient-to-br from-amber-500/5 to-transparent" :
        installment.status === "succeeded" ? "border-green-500/30 bg-gradient-to-br from-green-500/5 to-transparent" :
        "bg-card border-border hover:border-primary/30"
      )}
    >
      {/* Status indicator line */}
      <div className={cn(
        "absolute top-0 left-0 right-0 h-1",
        installment.status === "succeeded" ? "bg-green-500" :
        isOverdue ? "bg-destructive" :
        isUpcoming ? "bg-amber-500" :
        installment.status === "processing" ? "bg-blue-500" :
        "bg-muted"
      )} />

      <div className="flex items-start justify-between gap-4 pt-2">
        {/* Left side - Payment info */}
        <div className="flex items-start gap-3">
          <div className={cn(
            "w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0",
            config.bgColor,
            config.textColor
          )}>
            {installment.status === "succeeded" ? (
              <Check className="h-6 w-6" />
            ) : (
              <div className="text-center">
                <div className="text-lg font-bold leading-none">{installment.payment_number}</div>
                <div className="text-[10px] opacity-70">/{installment.total_payments}</div>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold">
                {formatAmount(Number(installment.amount))}
              </span>
              <span className="text-sm text-muted-foreground">{currency}</span>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              {installment.paid_at ? (
                <span className="text-green-600 dark:text-green-400">
                  Оплачен {format(new Date(installment.paid_at), "d MMMM yyyy", { locale: ru })}
                </span>
              ) : (
                <span className={isOverdue ? "text-destructive" : ""}>
                  {format(new Date(installment.due_date), "d MMMM yyyy", { locale: ru })}
                </span>
              )}
            </div>

            {/* Attempts info */}
            {installment.charge_attempts > 0 && installment.status !== "succeeded" && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3" />
                <span>Попыток: {installment.charge_attempts}/3</span>
              </div>
            )}

            {/* Error message */}
            {installment.error_message && (
              <div className="flex items-start gap-1.5 text-xs text-destructive mt-1">
                <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                <span className="line-clamp-2">{installment.error_message}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right side - Status & Actions */}
        <div className="flex flex-col items-end gap-2">
          <Badge 
            variant="outline" 
            className={cn("gap-1.5", config.textColor, config.borderColor, config.bgColor)}
          >
            {config.icon}
            {config.label}
          </Badge>

          {isOverdue && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {Math.abs(daysUntilDue)} дн. просрочки
            </Badge>
          )}

          {isUpcoming && !isOverdue && (
            <Badge className="gap-1 bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30">
              <Clock className="h-3 w-3" />
              {daysUntilDue === 0 ? "Сегодня" : `Через ${daysUntilDue} дн.`}
            </Badge>
          )}
        </div>
      </div>

      {/* Actions */}
      {installment.status === "pending" && (onCharge || onSendReminder) && (
        <div className="flex gap-2 mt-4 pt-3 border-t border-border/50">
          {onCharge && (
            <Button
              size="sm"
              onClick={() => onCharge(installment.id)}
              disabled={isCharging}
              className="gap-1.5 flex-1"
            >
              {isCharging ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="h-4 w-4" />
              )}
              Списать сейчас
            </Button>
          )}
          
          {onSendReminder && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSendReminder(installment.id)}
              disabled={isSendingReminder}
              className="gap-1.5"
            >
              {isSendingReminder ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Bell className="h-4 w-4" />
              )}
              Напомнить
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
