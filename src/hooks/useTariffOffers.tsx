import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type PaymentMethod = "full_payment" | "internal_installment" | "bank_installment";

// Preregistration settings for auto-charge after specific date
export interface PreregistrationConfig {
  first_charge_date?: string;           // "2026-02-05" - дата первого списания
  charge_offer_id?: string;             // UUID кнопки pay_now для списания
  notify_before_days?: number;          // За сколько дней уведомлять (default: 1)
  auto_convert_after_date?: boolean;    // Автоматически заменить на кнопку оплаты после даты
  charge_window_start?: number;         // День месяца начала окна списания (1-28)
  charge_window_end?: number;           // День месяца конца окна списания (1-28)
}

// Subscription/recurring settings (extended for grace period + auto-renewal config)
export interface RecurringConfig {
  // === Legacy fields (backward compatible) ===
  is_recurring?: boolean;               // Это подписка с автопродлением
  recurring_interval_days?: number;     // Интервал списания в днях (30 = месяц)
  charge_window_start?: number;         // День месяца начала окна списания
  charge_window_end?: number;           // День месяца конца окна списания
  
  // === NEW: Extended auto-renewal settings ===
  billing_period_mode?: 'month' | 'days';        // 'month' = calendar month, 'days' = fixed days
  billing_period_days?: number;                   // If mode='days', number of days (default 30)
  grace_hours?: number;                           // Grace period in hours (default 72)
  charge_attempts_per_day?: number;               // Attempts per day during grace (default 2)
  charge_windows_utc?: string[];                  // Deprecated: use charge_times_local
  charge_times_local?: string[];                  // Times in local timezone, e.g. ['09:00', '21:00']
  timezone?: string;                              // Timezone for charge windows (default 'Europe/Minsk')
  pre_due_reminders_days?: number[];              // Days before due to send reminders [7, 3, 1]
  post_due_reminders_policy?: 'daily' | 'none';   // Reminder policy during grace
  notify_before_each_charge?: boolean;            // Send notification before each charge attempt
  notify_grace_events?: boolean;                  // Send grace_started/24h/48h/expired notifications
}

export interface OfferMetaConfig {
  welcome_message?: {
    enabled: boolean;
    text: string;
    button?: {
      enabled: boolean;
      text: string;
      url: string;
    };
    media?: {
      type: "photo" | "video" | "document" | "video_note" | null;
      storage_path: string | null;
      filename?: string;
    };
  };
  // Preregistration settings
  preregistration?: PreregistrationConfig;
  // Recurring/subscription settings (auto-renewal config)
  recurring?: RecurringConfig;
}

export interface TariffOffer {
  id: string;
  tariff_id: string;
  offer_type: "pay_now" | "trial" | "preregistration";
  button_label: string;
  amount: number;
  reentry_amount: number | null; // Price for re-entry (former club members)
  trial_days: number | null;
  auto_charge_after_trial: boolean;
  auto_charge_amount: number | null;
  auto_charge_delay_days: number | null;
  auto_charge_offer_id: string | null; // Reference to pay_now offer for auto-charge
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
  // Meta field for welcome message config
  meta: OfferMetaConfig | null;
  created_at: string;
  updated_at: string;
}

export type TariffOfferInsert = Omit<TariffOffer, "id" | "created_at" | "updated_at" | "getcourse_offer_id" | "payment_method" | "installment_count" | "installment_interval_days" | "first_payment_delay_days" | "auto_charge_offer_id" | "reentry_amount" | "meta"> & { 
  getcourse_offer_id?: string | null;
  payment_method?: PaymentMethod;
  installment_count?: number | null;
  installment_interval_days?: number | null;
  first_payment_delay_days?: number | null;
  auto_charge_offer_id?: string | null;
  reentry_amount?: number | null;
  meta?: OfferMetaConfig | null;
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
      // Cast meta to any to satisfy Supabase's Json type
      const insertData = { ...offer, meta: offer.meta as any };
      const { data, error } = await supabase
        .from("tariff_offers")
        .insert(insertData)
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
      // Cast meta to any to satisfy Supabase's Json type
      const updateData = { ...offer, meta: offer.meta as any };
      const { data, error } = await supabase
        .from("tariff_offers")
        .update(updateData)
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
