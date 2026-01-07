import { Card, CardContent } from "@/components/ui/card";
import { 
  TrendingUp, 
  Clock, 
  AlertTriangle, 
  Check,
  CreditCard,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { InstallmentWithDetails } from "@/hooks/useInstallments";
import { isPast } from "date-fns";

interface InstallmentStatsProps {
  installments: InstallmentWithDetails[];
  currency?: string;
}

export function InstallmentStats({ installments, currency = "BYN" }: InstallmentStatsProps) {
  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const pending = installments.filter(i => i.status === "pending");
  const overdue = pending.filter(i => isPast(new Date(i.due_date)));
  const succeeded = installments.filter(i => i.status === "succeeded");
  const failed = installments.filter(i => i.status === "failed");

  const pendingAmount = pending.reduce((sum, i) => sum + Number(i.amount), 0);
  const overdueAmount = overdue.reduce((sum, i) => sum + Number(i.amount), 0);
  const succeededAmount = succeeded.reduce((sum, i) => sum + Number(i.amount), 0);

  const stats = [
    {
      label: "Ожидают оплаты",
      value: pending.length,
      amount: pendingAmount,
      icon: Clock,
      color: "text-amber-600 dark:text-amber-400",
      bgColor: "bg-amber-500/10",
      borderColor: "border-amber-500/20",
    },
    {
      label: "Просрочено",
      value: overdue.length,
      amount: overdueAmount,
      icon: AlertTriangle,
      color: "text-red-600 dark:text-red-400",
      bgColor: "bg-red-500/10",
      borderColor: "border-red-500/20",
      highlight: overdue.length > 0,
    },
    {
      label: "Успешно оплачено",
      value: succeeded.length,
      amount: succeededAmount,
      icon: Check,
      color: "text-green-600 dark:text-green-400",
      bgColor: "bg-green-500/10",
      borderColor: "border-green-500/20",
    },
    {
      label: "Ожидаемые поступления",
      value: null,
      amount: pendingAmount,
      icon: TrendingUp,
      color: "text-primary",
      bgColor: "bg-primary/10",
      borderColor: "border-primary/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((stat, index) => (
        <Card 
          key={index} 
          className={cn(
            "transition-all",
            stat.highlight && "border-destructive/50 bg-destructive/5"
          )}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center",
                stat.bgColor
              )}>
                <stat.icon className={cn("h-5 w-5", stat.color)} />
              </div>
              {stat.value !== null && (
                <span className={cn(
                  "text-2xl font-bold",
                  stat.highlight && "text-destructive"
                )}>
                  {stat.value}
                </span>
              )}
            </div>
            <div className="mt-3">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className={cn("text-lg font-semibold", stat.color)}>
                {formatAmount(stat.amount)} {currency}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
