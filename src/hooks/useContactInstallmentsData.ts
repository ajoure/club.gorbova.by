import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { InstallmentPayment } from "./useInstallments";
import { repaymentBalance } from "../../supabase/functions/_shared/installment-repayment-plan";

/**
 * Единые data-hooks для вкладки «Рассрочки» контакта.
 * Каждый ключ соответствует ОДНОЙ форме данных.
 * Wrapper и дочерние компоненты потребляют один и тот же query result через props.
 */

export interface UiPlan {
  orderId: string;
  orderNumber: string | null;
  productName: string;
  tariffName: string;
  currency: string;
  uiStatus: "pending" | "active" | "completed" | "review";
  totalCycles: number;
  paidCycles: number;
  perPayment: number;
  paidTotal: number;
  remainingTotal: number;
  effectiveTotal: number;
  nextChargeAt: string | null;
  createdAt: string;
}

// Supabase returns nested JSON/relationship fields that are not represented in
// the generated client type for this legacy query.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapOrderToPlan(order: any): UiPlan | null {
  const meta = order?.meta ?? {};
  const canonical = meta.installment ?? {};
  const progress = meta.installment_progress ?? null;
  let manualReview = meta.manual_review === true;
  const factualProgress = progress?.source === "repayment_factual_ledger";

  const totalCycles = Number(
    factualProgress ? progress?.billing_cycles : canonical.billing_cycles ?? progress?.billing_cycles ?? 0,
  );
  let paidCycles = Number(progress?.paid_billing_cycles ?? 0);
  const perPayment = Number(
    factualProgress ? progress?.per_payment_byn : canonical.per_payment_byn ?? progress?.per_payment_byn ?? 0,
  );
  const effectiveTotal = Number(
    canonical.effective_total_byn ??
      progress?.effective_total_byn ??
      (perPayment && totalCycles ? perPayment * totalCycles : 0),
  );
  let paidTotal = Number.NaN;
  let remainingTotal = Number.NaN;
  const factualPaid = Number(order?.paid_amount ?? 0);
  const ledger = Array.isArray(order.payments_v2) ? order.payments_v2 : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasLedgerPayment = ledger.some((p: any) => !p.is_deleted && ['succeeded', 'refunded', 'partially_refunded'].includes(p.status));

  if (hasLedgerPayment) {
    try {
      const balance = repaymentBalance({ orderId: order.id, userId: order.user_id,
        currency: order.currency || 'BYN', total: effectiveTotal, payments: ledger });
      paidTotal = balance.paidMinor / 100;
      remainingTotal = balance.remainingMinor / 100;
      paidCycles = balance.paidCount;
    } catch {
      // Never display a stale cached balance as money available to collect.
      manualReview = true;
    }
  } else if (factualPaid > 0 || paidCycles > 0) {
    manualReview = true;
  }

  // Ссылка/график без первого успешного взноса — checkout-заготовка, а не
  // рассрочка клиента. Такие записи видны только в диагностике автоплатежей.
  if (!hasLedgerPayment && paidCycles <= 0 && factualPaid <= 0) return null;

  let uiStatus: UiPlan["uiStatus"] = "pending";
  if (manualReview) uiStatus = "review";
  else if (remainingTotal === 0) uiStatus = "completed";
  else if (paidTotal > 0) uiStatus = "active";

  return {
    orderId: order.id,
    orderNumber: order.order_number ?? null,
    productName: order?.products_v2?.name ?? "Продукт",
    tariffName: order?.tariffs?.name ?? "Тариф",
    currency: order.currency || "BYN",
    uiStatus,
    totalCycles,
    paidCycles,
    perPayment,
    paidTotal,
    remainingTotal,
    effectiveTotal,
    nextChargeAt: progress?.next_charge_at ?? null,
    createdAt: order.created_at,
  };
}

export function useContactInternalInstallments(
  profileId?: string | null,
  userId?: string | null,
) {
  return useQuery({
    queryKey: ["contact-internal-installments", profileId ?? null, userId ?? null],
    enabled: Boolean(profileId || userId),
    queryFn: async (): Promise<UiPlan[]> => {
      const orFilters: string[] = [];
      if (profileId) orFilters.push(`profile_id.eq.${profileId}`);
      if (userId) orFilters.push(`user_id.eq.${userId}`);
      if (orFilters.length === 0) return [];

      // Dynamic OR construction requires the PostgREST builder's evolving generic type.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = supabase
        .from("orders_v2")
        .select(
          `id, user_id, order_number, currency, created_at, paid_amount, meta, product_id, tariff_id,
           payments_v2 (id, order_id, user_id, currency, provider, provider_payment_id, status, amount, refunded_amount, is_deleted, transaction_type),
           products_v2:product_id ( name ),
           tariffs:tariff_id ( name )`,
        )
        .order("created_at", { ascending: false });

      if (orFilters.length === 1) {
        const [col, , val] = orFilters[0].split(".");
        query = query.eq(col, val);
      } else {
        query = query.or(orFilters.join(","));
      }

      const { data, error } = await query;
      if (error) throw error;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filtered = (data ?? []).filter((row: any) => {
        const model = row?.meta?.installment?.model;
        const progressModel = row?.meta?.installment_progress?.model;
        return (
          model === "bepaid_finite_subscription" ||
          progressModel === "bepaid_finite_subscription"
        );
      });

      return filtered
        .map(mapOrderToPlan)
        .filter((p: UiPlan | null): p is UiPlan => p !== null);
    },
  });
}

export type LegacyInstallmentRow = InstallmentPayment & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscriptions_v2?: any;
};

export function useContactLegacyInstallments(userId?: string | null) {
  return useQuery({
    queryKey: ["user-all-installments", userId ?? null],
    enabled: !!userId,
    queryFn: async (): Promise<LegacyInstallmentRow[]> => {
      const { data, error } = await supabase
        .from("installment_payments")
        .select(
          `
          *,
          subscriptions_v2 (
            id, status,
            products_v2 ( id, name ),
            tariffs ( id, name )
          )
        `,
        )
        .eq("user_id", userId as string)
        .order("due_date", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as unknown as LegacyInstallmentRow[];
      const realSubscriptionIds = new Set(
        rows
          .filter((row) => row.status === "succeeded")
          .map((row) => row.subscription_id),
      );
      return rows.filter((row) => realSubscriptionIds.has(row.subscription_id));
    },
  });
}
