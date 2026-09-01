import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, ExternalLink, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useContactInternalInstallments as useContactInternalInstallmentsHook,
  type UiPlan,
} from "@/hooks/useContactInstallmentsData";
import { ExistingInstallmentRepaymentDialog } from "./ExistingInstallmentRepaymentDialog";

/**
 * Внутренние рассрочки контакта.
 * Одна карточка = одна исходная сделка (orders_v2). Filter — точный canonical marker.
 * UI-источник — orders_v2.meta.installment_progress.
 *
 * Data flow:
 * - Если передан prop `plans` — компонент чисто презентационный.
 * - Иначе — тянет данные через shared hook (single source of truth).
 */

interface ContactInternalInstallmentsProps {
  profileId?: string | null;
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  telegramUserId?: number | null;
  onOpenDeal?: (orderId: string) => void;
  /** Preloaded plans (wrapper-driven). When provided, `isLoading` prop drives skeleton. */
  plans?: UiPlan[];
  isLoading?: boolean;
}

const formatAmount = (value: unknown, currency = "BYN") => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
};

const STATUS_META: Record<
  UiPlan["uiStatus"],
  { label: string; className: string; icon: JSX.Element }
> = {
  pending: {
    label: "Ожидает первого платежа",
    className: "bg-muted text-muted-foreground border-muted-foreground/20",
    icon: <Clock className="w-3 h-3" />,
  },
  active: {
    label: "Активна",
    className: "bg-primary/10 text-primary border-primary/30",
    icon: <CreditCard className="w-3 h-3" />,
  },
  completed: {
    label: "Завершена",
    className: "bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400",
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  review: {
    label: "Требует проверки",
    className: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300",
    icon: <AlertTriangle className="w-3 h-3" />,
  },
};

export function ContactInternalInstallments({
  profileId,
  userId,
  userName,
  userEmail,
  telegramUserId,
  onOpenDeal,
  plans: plansProp,
  isLoading: isLoadingProp,
}: ContactInternalInstallmentsProps) {
  const navigate = useNavigate();

  // Standalone режим: если plans не пришли пропом — тянем сами через shared hook.
  const shouldFetch = plansProp === undefined;
  const query = useContactInternalInstallmentsHook(
    shouldFetch ? profileId : null,
    shouldFetch ? userId : null,
  );

  const plans = plansProp ?? query.data;
  const isLoading = isLoadingProp ?? (shouldFetch ? query.isLoading : false);

  if (!profileId && !userId && !plansProp) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!plans || plans.length === 0) {
    return null;
  }

  const order = { review: 0, active: 1, pending: 2, completed: 3 };
  const sorted = [...plans].sort(
    (a, b) => order[a.uiStatus] - order[b.uiStatus],
  );



  const handleOpen = (orderId: string) => {
    if (onOpenDeal) {
      onOpenDeal(orderId);
    } else {
      navigate(`/admin/deals?deal=${encodeURIComponent(orderId)}`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CreditCard className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Внутренние рассрочки</h3>
        <Badge variant="outline">{sorted.length}</Badge>
      </div>

      {sorted.map((plan) => {
        const meta = STATUS_META[plan.uiStatus];
        const percent =
          plan.totalCycles > 0
            ? Math.min(
                100,
                Math.round((plan.paidCycles / plan.totalCycles) * 100),
              )
            : 0;

        return (
          <Card
            key={plan.orderId}
            className={cn(
              plan.uiStatus === "review" && "border-amber-500/40",
              plan.uiStatus === "completed" && "border-green-500/30 bg-green-500/[0.03]",
            )}
          >
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{plan.productName}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    Тариф «{plan.tariffName}»
                  </p>
                </div>
                <Badge variant="outline" className={cn("gap-1 shrink-0", meta.className)}>
                  {meta.icon}
                  {meta.label}
                </Badge>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Оплачено {plan.paidCycles} из {plan.totalCycles || "—"}
                  </span>
                  <span className="font-medium">{percent}%</span>
                </div>
                <Progress value={percent} className="h-2" />
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <div className="flex justify-between col-span-2 sm:col-span-1">
                  <span className="text-muted-foreground">Платёж</span>
                  <span className="font-medium">
                    {formatAmount(plan.perPayment, plan.currency)}
                  </span>
                </div>
                <div className="flex justify-between col-span-2 sm:col-span-1">
                  <span className="text-muted-foreground">Оплачено</span>
                  <span
                    className={cn(
                      "font-medium",
                      plan.paidTotal > 0 && "text-green-600 dark:text-green-400",
                    )}
                  >
                    {formatAmount(plan.paidTotal, plan.currency)}
                  </span>
                </div>
                <div className="flex justify-between col-span-2 sm:col-span-1">
                  <span className="text-muted-foreground">Осталось</span>
                  <span className="font-medium">
                    {formatAmount(plan.remainingTotal, plan.currency)}
                  </span>
                </div>
                <div className="flex justify-between col-span-2 sm:col-span-1">
                  <span className="text-muted-foreground">Следующее</span>
                  <span className="font-medium">
                    {plan.uiStatus === "completed"
                      ? "—"
                      : plan.nextChargeAt
                        ? format(new Date(plan.nextChargeAt), "d MMM yyyy", { locale: ru })
                        : "—"}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
                <span className="text-xs font-mono text-muted-foreground truncate">
                  {plan.orderNumber ?? plan.orderId.slice(0, 8)}
                </span>
                <div className="flex flex-wrap gap-2">
                  <ExistingInstallmentRepaymentDialog
                    plan={plan}
                    userId={userId}
                    userName={userName}
                    userEmail={userEmail}
                    telegramUserId={telegramUserId}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => handleOpen(plan.orderId)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Открыть сделку
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
