import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { InstallmentPayment } from "./useInstallments";

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

function mapOrderToPlan(order: any): UiPlan | null {
  const meta = order?.meta ?? {};
  const canonical = meta.installment ?? {};
  const progress = meta.installment_progress ?? null;
  const manualReview = meta.manual_review === true;

  const totalCycles = Number(progress?.billing_cycles ?? canonical.billing_cycles ?? 0);
  const paidCycles = Number(progress?.paid_billing_cycles ?? 0);
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
    progress?.remaining_total_byn ?? Math.max(effectiveTotal - paidTotal, 0),
  );
  const factualPaid = Number(order?.paid_amount ?? 0);

  // Ссылка/график без первого успешного взноса — checkout-заготовка, а не
  // рассрочка клиента. Такие записи видны только в диагностике автоплатежей.
  if (paidCycles <= 0 && paidTotal <= 0 && factualPaid <= 0) return null;

  let uiStatus: UiPlan["uiStatus"] = "pending";
  if (manualReview) uiStatus = "review";
  else if (progress?.status === "completed") uiStatus = "completed";
  else if (progress?.status === "active") uiStatus = "active";

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

      let query: any = supabase
        .from("orders_v2")
        .select(
          `id, order_number, currency, created_at, paid_amount, meta, product_id, tariff_id,
           products_v2:product_id ( name ),
           tariffs:tariff_id ( name )`,
        )
        .eq("meta->>payment_method", "internal_installment")
        .order("created_at", { ascending: false });

      if (orFilters.length === 1) {
        const [col, , val] = orFilters[0].split(".");
        query = query.eq(col, val);
      } else {
        query = query.or(orFilters.join(","));
      }

      const { data, error } = await query;
      if (error) throw error;

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
