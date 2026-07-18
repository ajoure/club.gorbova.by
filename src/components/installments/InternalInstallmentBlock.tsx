import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { CreditCard, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Внутренняя рассрочка — блок для карточки сделки.
 *
 * Отображается ТОЛЬКО для точного canonical marker:
 *   order.meta.payment_method === 'internal_installment'
 *   && order.meta.installment.model === 'bepaid_finite_subscription'
 *
 * Все значения читаются из orders_v2.meta.installment_progress
 * (готовая проекция от Stage 3 backend-а). Никаких пересчётов по payments_v2.
 */

interface InternalInstallmentBlockProps {
  order: any;
}

function isCanonicalInternalInstallment(order: any): boolean {
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
  if (!isCanonicalInternalInstallment(order)) return null;

  const meta = order.meta as Record<string, any>;
  const progress = (meta.installment_progress ?? null) as Record<string, any> | null;
  const canonical = (meta.installment ?? {}) as Record<string, any>;
  const manualReview = meta.manual_review === true;
  const currency = order.currency || "BYN";

  // Fallback (нет ещё installment_progress — ждём первого платежа)
  const totalCycles = Number(
    progress?.billing_cycles ?? canonical.billing_cycles ?? 0,
  );
  const paidCycles = Number(progress?.paid_billing_cycles ?? 0);
  const remainingCycles = Number(
    progress?.remaining_billing_cycles ??
      (totalCycles > 0 ? totalCycles - paidCycles : 0),
  );
  const perPayment = Number(
    progress?.per_payment_byn ?? canonical.per_payment_byn ?? 0,
  );
  const effectiveTotal = Number(
    progress?.effective_total_byn ??
      canonical.effective_total_byn ??
      (perPayment && totalCycles ? perPayment * totalCycles : 0),
  );
  const paidTotal = Number(progress?.paid_total_byn ?? 0);
  const remainingTotal = Number(
    progress?.remaining_total_byn ??
      Math.max(effectiveTotal - paidTotal, 0),
  );
  const nextChargeAt = progress?.next_charge_at ?? null;
  const providerSubId =
    progress?.provider_subscription_id ??
    canonical.provider_subscription_id ??
    null;
  const rawStatus: string = progress?.status ?? "pending_first_charge";

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
    totalCycles > 0 ? Math.min(100, Math.round((paidCycles / totalCycles) * 100)) : 0;

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
              Оплачено {paidCycles} из {totalCycles || "—"}
            </span>
            <span className="font-medium">{percent}%</span>
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
