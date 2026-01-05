import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type ProductV2 = Database["public"]["Tables"]["products_v2"]["Row"];
type Tariff = Database["public"]["Tables"]["tariffs"]["Row"];
type PricingStage = Database["public"]["Tables"]["pricing_stages"]["Row"];
type TariffPrice = Database["public"]["Tables"]["tariff_prices"]["Row"];
type PaymentPlan = Database["public"]["Tables"]["payment_plans"]["Row"];
type Flow = Database["public"]["Tables"]["flows"]["Row"];

// Products
export function useProductsV2() {
  return useQuery({
    queryKey: ["products_v2"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_v2")
        .select("*, telegram_clubs(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useProductV2(productId: string | null) {
  return useQuery({
    queryKey: ["products_v2", productId],
    queryFn: async () => {
      if (!productId) return null;
      const { data, error } = await supabase
        .from("products_v2")
        .select("*, telegram_clubs(name)")
        .eq("id", productId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!productId,
  });
}

export function useCreateProductV2() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (product: Database["public"]["Tables"]["products_v2"]["Insert"]) => {
      const { data, error } = await supabase
        .from("products_v2")
        .insert(product)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products_v2"] });
      toast.success("Продукт создан");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useUpdateProductV2() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...product }: Partial<ProductV2> & { id: string }) => {
      const { data, error } = await supabase
        .from("products_v2")
        .update(product)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products_v2"] });
      toast.success("Продукт обновлён");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useDeleteProductV2() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products_v2").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products_v2"] });
      toast.success("Продукт удалён");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

// Tariffs
export function useTariffs(productId?: string) {
  return useQuery({
    queryKey: ["tariffs", productId],
    queryFn: async () => {
      let query = supabase
        .from("tariffs")
        .select("*")
        .order("display_order", { ascending: true });
      if (productId) {
        query = query.eq("product_id", productId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateTariff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tariff: Database["public"]["Tables"]["tariffs"]["Insert"]) => {
      const { data, error } = await supabase
        .from("tariffs")
        .insert(tariff)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tariffs"] });
      toast.success("Тариф создан");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useUpdateTariff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...tariff }: Partial<Tariff> & { id: string }) => {
      const { data, error } = await supabase
        .from("tariffs")
        .update(tariff)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tariffs"] });
      toast.success("Тариф обновлён");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useDeleteTariff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tariffs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tariffs"] });
      toast.success("Тариф удалён");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

// Pricing Stages
export function usePricingStages(productId?: string) {
  return useQuery({
    queryKey: ["pricing_stages", productId],
    queryFn: async () => {
      let query = supabase
        .from("pricing_stages")
        .select("*")
        .order("display_order", { ascending: true });
      if (productId) {
        query = query.eq("product_id", productId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreatePricingStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (stage: Database["public"]["Tables"]["pricing_stages"]["Insert"]) => {
      const { data, error } = await supabase
        .from("pricing_stages")
        .insert(stage)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pricing_stages"] });
      toast.success("Этап ценообразования создан");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useUpdatePricingStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...stage }: Partial<PricingStage> & { id: string }) => {
      const { data, error } = await supabase
        .from("pricing_stages")
        .update(stage)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pricing_stages"] });
      toast.success("Этап обновлён");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useDeletePricingStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pricing_stages").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pricing_stages"] });
      toast.success("Этап удалён");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

// Tariff Prices
export function useTariffPrices(tariffId?: string) {
  return useQuery({
    queryKey: ["tariff_prices", tariffId],
    queryFn: async () => {
      let query = supabase
        .from("tariff_prices")
        .select("*, pricing_stages(name)")
        .order("created_at", { ascending: true });
      if (tariffId) {
        query = query.eq("tariff_id", tariffId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateTariffPrice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (price: Database["public"]["Tables"]["tariff_prices"]["Insert"]) => {
      const { data, error } = await supabase
        .from("tariff_prices")
        .insert(price)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tariff_prices"] });
      toast.success("Цена добавлена");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useUpdateTariffPrice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...price }: Partial<TariffPrice> & { id: string }) => {
      const { data, error } = await supabase
        .from("tariff_prices")
        .update(price)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tariff_prices"] });
      toast.success("Цена обновлена");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useDeleteTariffPrice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tariff_prices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tariff_prices"] });
      toast.success("Цена удалена");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

// Payment Plans
export function usePaymentPlans(tariffId?: string) {
  return useQuery({
    queryKey: ["payment_plans", tariffId],
    queryFn: async () => {
      let query = supabase
        .from("payment_plans")
        .select("*")
        .order("display_order", { ascending: true });
      if (tariffId) {
        query = query.eq("tariff_id", tariffId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreatePaymentPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (plan: Database["public"]["Tables"]["payment_plans"]["Insert"]) => {
      const { data, error } = await supabase
        .from("payment_plans")
        .insert(plan)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment_plans"] });
      toast.success("План оплаты создан");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useUpdatePaymentPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...plan }: Partial<PaymentPlan> & { id: string }) => {
      const { data, error } = await supabase
        .from("payment_plans")
        .update(plan)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment_plans"] });
      toast.success("План обновлён");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useDeletePaymentPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("payment_plans").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment_plans"] });
      toast.success("План удалён");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

// Flows
export function useFlows(productId?: string) {
  return useQuery({
    queryKey: ["flows", productId],
    queryFn: async () => {
      let query = supabase
        .from("flows")
        .select("*")
        .order("start_date", { ascending: false });
      if (productId) {
        query = query.eq("product_id", productId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateFlow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (flow: Database["public"]["Tables"]["flows"]["Insert"]) => {
      const { data, error } = await supabase
        .from("flows")
        .insert(flow)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flows"] });
      toast.success("Поток создан");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useUpdateFlow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...flow }: Partial<Flow> & { id: string }) => {
      const { data, error } = await supabase
        .from("flows")
        .update(flow)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flows"] });
      toast.success("Поток обновлён");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useDeleteFlow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("flows").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flows"] });
      toast.success("Поток удалён");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

// Labels
export const PRICING_STAGE_TYPE_LABELS: Record<string, string> = {
  early_bird: "Ранняя цена",
  stage1: "Этап 1",
  stage2: "Этап 2",
  stage3: "Этап 3",
  regular: "Стандартная",
};

export const PAYMENT_PLAN_TYPE_LABELS: Record<string, string> = {
  full: "Полная оплата",
  installment: "Рассрочка",
  trial: "Пробный период",
};
