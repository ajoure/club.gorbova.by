import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Note: tariff_features table is not yet in the generated types,
// so we use explicit type casting

export interface TariffFeature {
  id: string;
  tariff_id: string;
  text: string;
  icon: string;
  is_bonus: boolean;
  is_highlighted: boolean;
  sort_order: number;
  visibility_mode: "always" | "date_range" | "until_date";
  active_from: string | null;
  active_to: string | null;
  label: string | null;
  link_url: string | null;
  bonus_type: string | null;
  created_at: string;
  updated_at: string;
}

export type TariffFeatureInsert = Omit<TariffFeature, "id" | "created_at" | "updated_at">;
export type TariffFeatureUpdate = Partial<TariffFeatureInsert> & { id: string };

export function useTariffFeatures(tariffId?: string) {
  return useQuery({
    queryKey: ["tariff-features", tariffId],
    queryFn: async () => {
      let query = supabase
        .from("tariff_features" as any)
        .select("*")
        .order("sort_order", { ascending: true });
      
      if (tariffId) {
        query = query.eq("tariff_id", tariffId);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return (data as unknown) as TariffFeature[];
    },
    enabled: !!tariffId,
  });
}

export function useProductTariffFeatures(productId?: string) {
  return useQuery({
    queryKey: ["product-tariff-features", productId],
    queryFn: async () => {
      if (!productId) return [];
      
      // First get all tariff IDs for this product
      const { data: tariffs, error: tariffsError } = await supabase
        .from("tariffs")
        .select("id")
        .eq("product_id", productId);
      
      if (tariffsError) throw tariffsError;
      if (!tariffs?.length) return [];
      
      const tariffIds = tariffs.map(t => t.id);
      
      const { data, error } = await supabase
        .from("tariff_features" as any)
        .select("*")
        .in("tariff_id", tariffIds)
        .order("sort_order", { ascending: true });
      
      if (error) throw error;
      return (data as unknown) as TariffFeature[];
    },
    enabled: !!productId,
  });
}

export function useCreateTariffFeature() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (feature: TariffFeatureInsert) => {
      const { data, error } = await supabase
        .from("tariff_features" as any)
        .insert(feature as any)
        .select()
        .single();
      
      if (error) throw error;
      return (data as unknown) as TariffFeature;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tariff-features"] });
      queryClient.invalidateQueries({ queryKey: ["product-tariff-features"] });
      toast.success("Пункт добавлен");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useUpdateTariffFeature() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...feature }: TariffFeatureUpdate) => {
      const { data, error } = await supabase
        .from("tariff_features" as any)
        .update(feature as any)
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return (data as unknown) as TariffFeature;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tariff-features"] });
      queryClient.invalidateQueries({ queryKey: ["product-tariff-features"] });
      toast.success("Пункт обновлён");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useDeleteTariffFeature() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("tariff_features" as any)
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tariff-features"] });
      queryClient.invalidateQueries({ queryKey: ["product-tariff-features"] });
      toast.success("Пункт удалён");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useBulkUpdateTariffFeatures() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (features: TariffFeatureUpdate[]) => {
      const results = await Promise.all(
        features.map(async ({ id, ...feature }) => {
          const { data, error } = await supabase
            .from("tariff_features" as any)
            .update(feature as any)
            .eq("id", id)
            .select()
            .single();
          
          if (error) throw error;
          return data;
        })
      );
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tariff-features"] });
      queryClient.invalidateQueries({ queryKey: ["product-tariff-features"] });
    },
  });
}

// Helper to check if a feature is currently visible based on date settings
export function isFeatureVisible(feature: TariffFeature): boolean {
  if (feature.visibility_mode === "always") return true;
  
  const now = new Date();
  
  if (feature.visibility_mode === "until_date" && feature.active_to) {
    return now <= new Date(feature.active_to);
  }
  
  if (feature.visibility_mode === "date_range") {
    const from = feature.active_from ? new Date(feature.active_from) : null;
    const to = feature.active_to ? new Date(feature.active_to) : null;
    
    if (from && now < from) return false;
    if (to && now > to) return false;
    return true;
  }
  
  return true;
}
