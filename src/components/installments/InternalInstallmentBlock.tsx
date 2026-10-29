import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { CreditCard, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useContactInternalInstallments } from "@/hooks/useContactInstallmentsData";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Внутренняя рассрочка — блок для карточки сделки.
 *
 * Отображается ТОЛЬКО для точного canonical marker:
 *   order.meta.payment_method === 'internal_installment'
 *   && order.meta.installment.model === 'bepaid_finite_subscription'
 *
 * Shared factual projection with the contact installment menu.
 * Rebill receipts stay on their own deals and count toward the original debt.
 */

interface InternalInstallmentBlockProps {
  order: {
    id: string;
    profile_id?: string | null;
    user_id: string | null;
    bepaid_subscription_id?: string | null;
    meta?: { payment_method?: unknown; installment?: Record<string, unknown>; installment_progress?: Record<string, unknown> } | null;
  };
}

function isCanonicalInternalInstallment(order: InternalInstallmentBlockProps['order'] | null | undefined): boolean {
  const meta = order?.meta;
  if (!meta || typeof meta !== "object") return false;
  const pm = meta.payment_method;
  const model = meta.installment?.model;
  const progressModel = meta.installment_progress?.model;
  if (pm !== "internal_installment") return false;
  return (
    model === "bepaid_finite_subscription" ||
    progressModel === "bepaid_finite_subscription"
  );
}

const formatAmount = (value: unknown, currency = "BYN") => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
};

export function InternalInstallmentBlock({ order }: InternalInstallmentBlockProps) {
  const canonicalInstallment = isCanonicalInternalInstallment(order);
  const query = useContactInternalInstallments(
    canonicalInstallment ? order.profile_id : null,
    canonicalInstallment ? order.user_id : null,
  );
  if (!canonicalInstallment) return null;
  if (query.isLoading) return <Card><CardContent className="p-4"><Skeleton className="h-32 w-full" /></CardContent></Card>;
  const plan = query.data?.find(candidate => candidate.orderId === order.id);
  if (!plan) return <Card><CardContent className="p-4 text-sm text-amber-700">Расчёт рассрочки требует проверки платежей</CardContent></Card>;

  const currency = plan.currency;
  const { totalCycles, paidCycles, perPayment, effectiveTotal, paidTotal, remainingTotal, nextChargeAt } = plan;
  const providerSubId = order.bepaid_subscription_id
    ?? order.meta?.installment_progress?.provider_subscription_id
    ?? order.meta?.installment?.provider_subscription_id ?? null;
  const manualReview = plan.uiStatus === 'review';
  const rawStatus = plan.uiStatus;

  // UI-status resolution (backend expired ≠ UI)
  let uiStatus: "pending" | "active" | "completed" | "review" = "pending";
  let statusLabel = "Ожидает первого платежа";
  let statusBadgeClass =
    "bg-muted text-muted-foreground border-muted-foreground/20";
  let statusIcon = <CreditCard className="w-3 h-3" />;

  if (manualReview) {
    uiStatus = "review";
    statusLabel = "Требует проверки";
    statusBadgeClass = "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300";
    statusIcon = <AlertTriangle className="w-3 h-3" />;
  } else if (rawStatus === "completed") {
    uiStatus = "completed";
    statusLabel = "Завершена";
    statusBadgeClass = "bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400";
    statusIcon = <CheckCircle2 className="w-3 h-3" />;
  } else if (rawStatus === "active") {
    uiStatus = "active";
    statusLabel = "Активна";
    statusBadgeClass = "bg-primary/10 text-primary border-primary/30";
    statusIcon = <CreditCard className="w-3 h-3" />;
  }

  const percent =
    totalCycles > 0 && Number.isFinite(paidCycles) ? Math.min(100, Math.round((paidCycles / totalCycles) * 100)) : 0;

  return (
    <Card
      className={cn(
        "border",
        uiStatus === "review" && "border-amber-500/40",
        uiStatus === "completed" && "border-green-500/30 bg-green-500/[0.03]",
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
            <CreditCard className="w-4 h-4" />
            Внутренняя рассрочка
          </CardTitle>
          <Badge variant="outline" className={cn("gap-1", statusBadgeClass)}>
            {statusIcon}
            {statusLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Оплачено {Number.isFinite(paidCycles) ? paidCycles : "—"} из {totalCycles || "—"}
            </span>
            <span className="font-medium">{Number.isFinite(paidCycles) ? `${percent}%` : "—"}</span>
          </div>
          <Progress value={percent} className="h-2" />
        </div>

        <Separator />

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Платёж</span>
          <span className="font-medium">{formatAmount(perPayment, currency)}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Общая сумма</span>
          <span className="font-medium">{formatAmount(effectiveTotal, currency)}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Оплачено</span>
          <span
            className={cn(
              "font-medium",
              paidTotal > 0 && "text-green-600 dark:text-green-400",
            )}
          >
            {formatAmount(paidTotal, currency)}
          </span>
        </div>
        <Separator />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Осталось</span>
          <span className="font-medium">{formatAmount(remainingTotal, currency)}</span>
        </div>

        <Separator />

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Следующее списание</span>
          <span className="font-medium">
            {uiStatus === "completed"
              ? "—"
              : nextChargeAt
                ? format(new Date(nextChargeAt), "d MMMM yyyy", { locale: ru })
                : "—"}
          </span>
        </div>
        <Separator />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Провайдер</span>
          <span className="font-medium">bePaid</span>
        </div>

        {providerSubId && (
          <>
            <Separator />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Provider subscription</span>
              <span className="font-mono truncate max-w-[220px]" title={String(providerSubId)}>
                {String(providerSubId)}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export { isCanonicalInternalInstallment };
