import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, CheckCircle2, Clock, ShieldCheck, ExternalLink, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { usePaymentIssuesCounters } from "@/hooks/admin/usePaymentIssuesCounters";
import {
  usePaymentIssuesSubscriptions,
  type PaymentIssuesFilter,
} from "@/hooks/admin/usePaymentIssuesSubscriptions";
import { PaymentIssueStatusBadge } from "./PaymentIssueStatusBadge";
import { PaymentIssuesProofModal } from "./PaymentIssuesProofModal";

/**
 * Phase 3.6-B. Вкладка «Проблемы с оплатой» (UI-only, read-only).
 * Источник: subscriptions_v2_safe.meta.stripe.dunning_status.
 * Никаких мутаций, edge-функций, миграций.
 */

const FILTERS: { id: PaymentIssuesFilter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "past_due_grace", label: "Ожидает повторной оплаты" },
  { id: "final_failure", label: "Оплата не восстановлена" },
  { id: "canceled_after_dunning", label: "Доступ будет отозван" },
  { id: "recovered", label: "Повторная оплата прошла" },
];

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function translateFailureReason(reason: string | null): string {
  if (!reason) return "—";
  const map: Record<string, string> = {
    insufficient_funds: "Недостаточно средств на карте",
    card_declined: "Банк отклонил списание",
    expired_card: "Срок действия карты истёк",
    authentication_required: "Требуется подтверждение от банка",
    do_not_honor: "Банк отклонил операцию",
    generic_decline: "Банк отклонил операцию",
    processing_error: "Ошибка обработки на стороне платёжной системы",
    lost_card: "Карта помечена как утерянная",
    stolen_card: "Карта помечена как украденная",
  };
  return map[reason] ?? reason;
}

interface StatCardProps {
  icon: typeof Clock;
  title: string;
  value: number;
  tone: "amber" | "destructive" | "emerald" | "muted";
}

function StatCard({ icon: Icon, title, value, tone }: StatCardProps) {
  const toneClass = {
    amber: "text-amber-600",
    destructive: "text-destructive",
    emerald: "text-emerald-600",
    muted: "text-muted-foreground",
  }[tone];
  return (
    <div className="rounded-lg border bg-card p-4 flex items-start gap-3">
      <div className={cn("rounded-md p-2 bg-muted/50", toneClass)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="text-2xl font-semibold mt-0.5">{value}</div>
      </div>
    </div>
  );
}

export function PaymentIssuesTabContent() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<PaymentIssuesFilter>("all");
  const [proofOpen, setProofOpen] = useState(false);

  const counters = usePaymentIssuesCounters();
  const { data: rows = [], isLoading } = usePaymentIssuesSubscriptions(filter);

  const totalCohort =
    (counters.data?.awaitingRetry ?? 0) +
    (counters.data?.notRecovered ?? 0) +
    (counters.data?.recoveredLast30d ?? 0);

  return (
    <div className="space-y-4 py-2">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Проблемы с оплатой</h1>
        <p className="text-xs text-muted-foreground">
          Подписки, по которым не прошла повторная оплата. Раздел только показывает информацию —
          ничего не отзывает и не изменяет автоматически из этого экрана.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          icon={Clock}
          title="Ожидает повторной оплаты"
          value={counters.data?.awaitingRetry ?? 0}
          tone="amber"
        />
        <StatCard
          icon={AlertCircle}
          title="Оплата не восстановлена"
          value={counters.data?.notRecovered ?? 0}
          tone="destructive"
        />
        <StatCard
          icon={CheckCircle2}
          title="Повторная оплата прошла (30 дней)"
          value={counters.data?.recoveredLast30d ?? 0}
          tone="emerald"
        />
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "px-3 h-7 rounded-full text-xs font-medium transition-all border",
                active
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background text-muted-foreground border-border hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Загрузка…</div>
        ) : totalCohort === 0 ? (
          <div className="p-10 text-center space-y-2">
            <ShieldCheck className="h-8 w-8 mx-auto text-emerald-600" />
            <div className="text-sm font-medium">Проблем с оплатой сейчас нет.</div>
            <div className="text-xs text-muted-foreground">
              Подписки с неуспешной повторной оплатой появятся здесь автоматически.
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            По выбранному фильтру записей нет.
          </div>
        ) : (
          <div className="table-scroll-x overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr className="text-left">
                  <th className="p-2 font-medium">Клиент</th>
                  <th className="p-2 font-medium">Продукт / тариф</th>
                  <th className="p-2 font-medium">Статус</th>
                  <th className="p-2 font-medium">Следующая попытка / отзыв</th>
                  <th className="p-2 font-medium">Причина отказа</th>
                  <th className="p-2 font-medium">Сумма</th>
                  <th className="p-2 font-medium text-right">Действие</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t hover:bg-muted/20">
                    <td className="p-2 align-top">
                      <div className="font-medium">{row.client_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{row.client_email ?? "—"}</div>
                    </td>
                    <td className="p-2 align-top">
                      <div>{row.product_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{row.tariff_title ?? "—"}</div>
                    </td>
                    <td className="p-2 align-top">
                      <PaymentIssueStatusBadge status={row.dunning_status} showHint />
                    </td>
                    <td className="p-2 align-top whitespace-nowrap">
                      {formatDate(row.cancel_at ?? row.next_payment_attempt)}
                    </td>
                    <td className="p-2 align-top max-w-xs">
                      <span className="text-xs">{translateFailureReason(row.last_failure_reason)}</span>
                    </td>
                    <td className="p-2 align-top whitespace-nowrap">
                      {row.amount != null
                        ? `${row.amount.toFixed(2)} ${row.currency ?? ""}`.trim()
                        : "—"}
                    </td>
                    <td className="p-2 align-top text-right">
                      {row.user_id ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            navigate(`/admin/contacts?contact=${row.user_id}&from=payment-issues`)
                          }
                        >
                          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                          Открыть клиента
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Runtime proof section */}
      <details className="rounded-lg border bg-card p-3">
        <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          Ручная проверка восстановления доступа
        </summary>
        <div className="mt-3 space-y-2 text-xs text-muted-foreground">
          <p>
            Реальная проверка автоматического отзыва доступа после финального отказа возможна
            только на реальном событии от платёжной системы. До появления первого такого случая
            проверка ожидает естественной эскалации (3–4 суток).
          </p>
          <div className="flex flex-wrap gap-3 text-xs">
            <span>
              Оплата не восстановлена сейчас: <b>{counters.data?.notRecovered ?? 0}</b>
            </span>
            <span>
              Первое появление:{" "}
              <b>{formatDate(counters.data?.earliestFinalFailureAt ?? null)}</b>
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={() => setProofOpen(true)}>
            Проверить вручную
          </Button>
        </div>
      </details>

      <PaymentIssuesProofModal open={proofOpen} onOpenChange={setProofOpen} />
    </div>
  );
}
