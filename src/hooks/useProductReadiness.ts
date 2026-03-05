import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ReadinessReasonCode =
  | "ok"
  | "product_not_active"
  | "no_active_tariff"
  | "no_active_pay_now_offer"
  | "unknown";

export interface ProductReadiness {
  isReady: boolean;
  reasonCode: ReadinessReasonCode;
  reasonLabel: string;
}

const REASON_LABELS: Record<ReadinessReasonCode, string> = {
  ok: "Готов к оплате",
  product_not_active: "Продукт не активен",
  no_active_tariff: "Нет активного тарифа",
  no_active_pay_now_offer: "Нет активной кнопки оплаты (pay_now)",
  unknown: "Не удалось определить готовность",
};

/**
 * Computes payment readiness for a set of products.
 * Readiness = product.status === 'active' + >=1 active tariff + >=1 active pay_now offer.
 * trial/preregistration offers do NOT count.
 */
export function useProductReadiness(
  products: Array<{ id: string; status: string }> | undefined
) {
  const productIds = products?.map((p) => p.id) ?? [];

  return useQuery({
    queryKey: ["product_readiness", productIds.sort().join(",")],
    queryFn: async (): Promise<Map<string, ProductReadiness>> => {
      const map = new Map<string, ProductReadiness>();
      if (!products || products.length === 0) return map;

      // 1. Get active tariffs per product
      const { data: tariffs } = await supabase
        .from("tariffs")
        .select("id, product_id, is_active")
        .in("product_id", productIds)
        .eq("is_active", true);

      // Build set of product_ids with active tariffs + collect tariff ids
      const productHasActiveTariff = new Set<string>();
      const activeTariffIds: string[] = [];
      tariffs?.forEach((t) => {
        productHasActiveTariff.add(t.product_id);
        activeTariffIds.push(t.id);
      });

      // 2. Get active pay_now offers for those tariffs
      const productHasPayNow = new Set<string>();
      if (activeTariffIds.length > 0) {
        const { data: offers } = await supabase
          .from("tariff_offers")
          .select("tariff_id, offer_type, is_active")
          .in("tariff_id", activeTariffIds)
          .eq("is_active", true)
          .eq("offer_type", "pay_now");

        // Map tariff_id back to product_id
        const tariffToProduct = new Map<string, string>();
        tariffs?.forEach((t) => tariffToProduct.set(t.id, t.product_id));

        offers?.forEach((o) => {
          const pid = tariffToProduct.get(o.tariff_id);
          if (pid) productHasPayNow.add(pid);
        });
      }

      // 3. Compute readiness per product
      for (const product of products) {
        let reasonCode: ReadinessReasonCode;

        if (product.status !== "active") {
          reasonCode = "product_not_active";
        } else if (!productHasActiveTariff.has(product.id)) {
          reasonCode = "no_active_tariff";
        } else if (!productHasPayNow.has(product.id)) {
          reasonCode = "no_active_pay_now_offer";
        } else {
          reasonCode = "ok";
        }

        map.set(product.id, {
          isReady: reasonCode === "ok",
          reasonCode,
          reasonLabel: REASON_LABELS[reasonCode],
        });
      }

      return map;
    },
    enabled: !!products && products.length > 0,
    staleTime: 30_000,
  });
}
