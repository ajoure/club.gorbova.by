/**
 * useOrderOfferMeta — резолвит offer и его meta для конкретного заказа.
 *
 * Стратегия:
 *   1. order.offer_id (или цепочка через meta) — точно купленный оффер.
 *   2. fallback: tariff_id, если у тарифа РОВНО один активный оффер.
 *   3. иначе offer=null.
 *
 * Используется в /purchases для проверки правил «Сформировать документ».
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  getOrderOfferId,
  type TariffOfferLite,
  type ResolvedOffer,
} from "@/lib/documents/purchaseDocumentRules";
import { resolveOfferForOrder } from "@/lib/documents/purchaseDocumentRules";

interface OrderForOffer {
  id: string;
  offer_id?: string | null;
  tariff_id?: string | null;
  meta?: Record<string, any> | null;
}

export function useOrderOfferMeta(order: OrderForOffer | null | undefined) {
  return useQuery({
    queryKey: [
      "order-offer-meta",
      order?.id,
      order?.offer_id,
      order?.tariff_id,
      getOrderOfferId(order || undefined),
    ],
    enabled: !!order,
    staleTime: 60_000,
    queryFn: async (): Promise<ResolvedOffer> => {
      if (!order) {
        return { offer: null, source: "none", reason: "no_offer_id_no_tariff_id" };
      }
      const offerId = getOrderOfferId(order);
      let offers: TariffOfferLite[] = [];
      if (offerId) {
        const { data } = await supabase
          .from("tariff_offers")
          .select("id, tariff_id, is_active, meta")
          .eq("id", offerId)
          .limit(1);
        offers = (data || []) as TariffOfferLite[];
      } else if (order.tariff_id) {
        const { data } = await supabase
          .from("tariff_offers")
          .select("id, tariff_id, is_active, meta")
          .eq("tariff_id", order.tariff_id);
        offers = (data || []) as TariffOfferLite[];
      }
      return resolveOfferForOrder({ order, tariffOffers: offers });
    },
  });
}
