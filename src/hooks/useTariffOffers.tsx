import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type PaymentMethod = "full_payment" | "internal_installment" | "bank_installment";

export interface TariffOffer {
  id: string;
  tariff_id: string;
  offer_type: "pay_now" | "trial";
  button_label: string;
  amount: number;
  trial_days: number | null;
  auto_charge_after_trial: boolean;
  auto_charge_amount: number | null;
  auto_charge_delay_days: number | null;
  requires_card_tokenization: boolean;
  is_active: boolean;
  is_primary: boolean;
  visible_from: string | null;
  visible_to: string | null;
  sort_order: number;
  getcourse_offer_id: string | null;
  reject_virtual_cards: boolean;
  // Installment fields
  payment_method: PaymentMethod;
  installment_count: number | null;
  installment_interval_days: number | null;
  first_payment_delay_days: number | null;
  created_at: string;
  updated_at: string;
}

export type TariffOfferInsert = Omit<TariffOffer, "id" | "created_at" | "updated_at" | "getcourse_offer_id" | "payment_method" | "installment_count" | "installment_interval_days" | "first_payment_delay_days"> & { 
  getcourse_offer_id?: string | null;
  payment_method?: PaymentMethod;
  installment_count?: number | null;
  installment_interval_days?: number | null;
  first_payment_delay_days?: number | null;
};
export type TariffOfferUpdate = Partial<Omit<TariffOffer, "id" | "created_at" | "updated_at">> & { id: string };

export function useTariffOffers(tariffId?: string) {
  return useQuery({
    queryKey: ["tariff_offers", tariffId],
    queryFn: async () => {
      let query = supabase
        .from("tariff_offers")
        .select("*")
        .order("sort_order", { ascending: true });
      
      if (tariffId) {
        query = query.eq("tariff_id", tariffId);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as TariffOffer[];
    },
  });
}

export function useProductOffers(productId?: string) {
  return useQuery({
    queryKey: ["product_offers", productId],
    queryFn: async () => {
      if (!productId) return [];
      
      // First get all tariffs for this product
      const { data: tariffs, error: tariffsError } = await supabase
        .from("tariffs")
        .select("id")
        .eq("product_id", productId);
      
      if (tariffsError) throw tariffsError;
      if (!tariffs?.length) return [];
      
      const tariffIds = tariffs.map(t => t.id);
      
      // Then get all offers for these tariffs
      const { data, error } = await supabase
        .from("tariff_offers")
        .select("*, tariffs(id, name, code)")
        .in("tariff_id", tariffIds)
        .order("sort_order", { ascending: true });
      
      if (error) throw error;
      return data as (TariffOffer & { tariffs: { id: string; name: string; code: string } })[];
    },
    enabled: !!productId,
  });
}

export function useCreateTariffOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (offer: TariffOfferInsert) => {
      const { data, error } = await supabase
        .from("tariff_offers")
        .insert(offer)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tariff_offers"] });
      queryClient.invalidateQueries({ queryKey: ["product_offers"] });
      toast.success("Кнопка оплаты создана");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useUpdateTariffOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...offer }: TariffOfferUpdate) => {
      const { data, error } = await supabase
        .from("tariff_offers")
        .update(offer)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tariff_offers"] });
      queryClient.invalidateQueries({ queryKey: ["product_offers"] });
      toast.success("Кнопка оплаты обновлена");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useDeleteTariffOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tariff_offers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tariff_offers"] });
      queryClient.invalidateQueries({ queryKey: ["product_offers"] });
      toast.success("Кнопка оплаты удалена");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

// Helper to create default offers for a tariff
export function useCreateDefaultOffers() {
  const createOffer = useCreateTariffOffer();
  
  return useMutation({
    mutationFn: async ({ tariffId, price, trialPrice = 1, trialDays = 5 }: { 
      tariffId: string; 
      price: number;
      trialPrice?: number;
      trialDays?: number;
    }) => {
      // Create pay_now offer (primary)
      await createOffer.mutateAsync({
        tariff_id: tariffId,
        offer_type: "pay_now",
        button_label: "Оплатить",
        amount: price,
        trial_days: null,
        auto_charge_after_trial: false,
        auto_charge_amount: null,
        auto_charge_delay_days: null,
        requires_card_tokenization: false,
        is_active: true,
        is_primary: true,
        visible_from: null,
        visible_to: null,
        sort_order: 0,
        reject_virtual_cards: false,
      });
      
      // Create trial offer
      await createOffer.mutateAsync({
        tariff_id: tariffId,
        offer_type: "trial",
        button_label: `Демо-доступ ${trialPrice} BYN / ${trialDays} дней`,
        amount: trialPrice,
        trial_days: trialDays,
        auto_charge_after_trial: true,
        auto_charge_amount: price,
        auto_charge_delay_days: trialDays,
        requires_card_tokenization: true,
        is_active: true,
        is_primary: false,
        visible_from: null,
        visible_to: null,
        sort_order: 1,
        reject_virtual_cards: false,
      });
    },
  });
}

// Hook to set primary offer (unsets other primaries for same tariff)
export function useSetPrimaryOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ offerId, tariffId }: { offerId: string; tariffId: string }) => {
      // First unset all primaries for this tariff
      await supabase
        .from("tariff_offers")
        .update({ is_primary: false })
        .eq("tariff_id", tariffId)
        .eq("offer_type", "pay_now");
      
      // Then set the new primary
      const { error } = await supabase
        .from("tariff_offers")
        .update({ is_primary: true })
        .eq("id", offerId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tariff_offers"] });
      queryClient.invalidateQueries({ queryKey: ["product_offers"] });
      toast.success("Основная цена установлена");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}
