import { cn } from "@/lib/utils";
import type { PaymentIssueStatus } from "@/hooks/admin/usePaymentIssuesCounters";

/**
 * Phase 3.6-B. Бейдж статуса оплаты — только русские формулировки.
 * Запрещены: Dunning, Recovery, Final failure, Past due, Smart Retry, Grace.
 */
export const PAYMENT_ISSUE_LABELS: Record<PaymentIssueStatus, string> = {
  past_due_grace: "Ожидает повторной оплаты",
  final_failure: "Оплата не восстановлена",
  canceled_after_dunning: "Доступ будет отозван",
  recovered: "Повторная оплата прошла",
};

export const PAYMENT_ISSUE_HINTS: Record<PaymentIssueStatus, string> = {
  past_due_grace: "Доступ пока сохранён",
  final_failure: "Доступ будет отозван автоматически",
  canceled_after_dunning: "Доступ будет отозван автоматически",
  recovered: "Подписка восстановлена",
};

const TONE: Record<PaymentIssueStatus, string> = {
  past_due_grace: "bg-amber-500/15 text-amber-600 border border-amber-500/30",
  final_failure: "bg-destructive/15 text-destructive border border-destructive/30",
  canceled_after_dunning: "bg-destructive/15 text-destructive border border-destructive/30",
  recovered: "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30",
};

interface Props {
  status: PaymentIssueStatus;
  className?: string;
  showHint?: boolean;
}

export function PaymentIssueStatusBadge({ status, className, showHint = false }: Props) {
  return (
    <div className={cn("inline-flex flex-col items-start gap-0.5", className)}>
      <span
        className={cn(
          "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap",
          TONE[status],
        )}
      >
        {PAYMENT_ISSUE_LABELS[status]}
      </span>
      {showHint && (
        <span className="text-[10px] text-muted-foreground">{PAYMENT_ISSUE_HINTS[status]}</span>
      )}
    </div>
  );
}
