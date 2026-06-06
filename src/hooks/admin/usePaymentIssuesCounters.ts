import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Phase 3.6-B (UI-only, read-only).
 * Счётчики подписок с проблемами оплаты Stripe.
 * Источник: subscriptions_v2_safe.meta.stripe.dunning_status.
 * Никаких записей в БД.
 */
export type PaymentIssueStatus =
  | "past_due_grace"
  | "final_failure"
  | "canceled_after_dunning"
  | "recovered";

export interface PaymentIssuesCounters {
  awaitingRetry: number; // past_due_grace
  notRecovered: number; // final_failure + canceled_after_dunning
  recoveredLast30d: number; // recovered за 30 дней
  totalActiveProblems: number; // awaitingRetry + notRecovered
  earliestFinalFailureAt: string | null;
  hasProblems: boolean;
}

export function usePaymentIssuesCounters() {
  return useQuery<PaymentIssuesCounters>({
    queryKey: ["payment-issues-counters"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions_v2_safe")
        .select("id, meta, updated_at")
        .eq("provider", "stripe")
        .not("meta->stripe->>dunning_status", "is", null)
        .limit(1000);

      if (error || !data) {
        return {
          awaitingRetry: 0,
          notRecovered: 0,
          recoveredLast30d: 0,
          totalActiveProblems: 0,
          earliestFinalFailureAt: null,
          hasProblems: false,
        };
      }

      const cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
      let awaitingRetry = 0;
      let notRecovered = 0;
      let recoveredLast30d = 0;
      let earliestFinal: number | null = null;

      for (const row of data) {
        const meta = (row.meta ?? {}) as Record<string, any>;
        const status = meta?.stripe?.dunning_status as PaymentIssueStatus | undefined;
        if (!status) continue;

        if (status === "past_due_grace") awaitingRetry++;
        else if (status === "final_failure" || status === "canceled_after_dunning") {
          notRecovered++;
          const t = row.updated_at ? Date.parse(row.updated_at) : NaN;
          if (!Number.isNaN(t) && (earliestFinal == null || t < earliestFinal)) {
            earliestFinal = t;
          }
        } else if (status === "recovered") {
          const t = row.updated_at ? Date.parse(row.updated_at) : NaN;
          if (!Number.isNaN(t) && t >= cutoff30d) recoveredLast30d++;
        }
      }

      const totalActiveProblems = awaitingRetry + notRecovered;

      return {
        awaitingRetry,
        notRecovered,
        recoveredLast30d,
        totalActiveProblems,
        earliestFinalFailureAt: earliestFinal ? new Date(earliestFinal).toISOString() : null,
        hasProblems: totalActiveProblems > 0,
      };
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}
