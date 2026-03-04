import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const RELATION_TYPE_LABELS: Record<string, string> = {
  includes: "Включает",
  module: "Модуль",
  bundle: "Бандл",
  upsell: "Апселл",
};

export const RELATION_TYPES = Object.keys(RELATION_TYPE_LABELS);

export interface ProductRelation {
  id: string;
  parent_product_id: string;
  child_product_id: string;
  relation_type: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  child_product?: {
    id: string;
    name: string;
    status: string;
  };
}

export function useProductRelations(parentId?: string) {
  return useQuery({
    queryKey: ["product_relations", parentId],
    queryFn: async () => {
      if (!parentId) return [];
      const { data, error } = await supabase
        .from("product_relations")
        .select("*, child_product:products_v2!product_relations_child_product_id_fkey(id, name, status)")
        .eq("parent_product_id", parentId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []).map((r: any) => ({
        ...r,
        child_product: r.child_product,
      })) as ProductRelation[];
    },
    enabled: !!parentId,
  });
}

// Check if product is a child of any parent
export function useProductParents(childId?: string) {
  return useQuery({
    queryKey: ["product_parents", childId],
    queryFn: async () => {
      if (!childId) return [];
      const { data, error } = await supabase
        .from("product_relations")
        .select("parent_product_id")
        .eq("child_product_id", childId)
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
    enabled: !!childId,
  });
}

// Batch: get all relation counts for product list
export function useProductRelationCounts() {
  return useQuery({
    queryKey: ["product_relation_counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_relations")
        .select("parent_product_id, child_product_id")
        .eq("is_active", true);
      if (error) throw error;

      const parentIds = new Set<string>();
      const childIds = new Set<string>();
      (data || []).forEach((r: any) => {
        parentIds.add(r.parent_product_id);
        childIds.add(r.child_product_id);
      });
      return { parentIds, childIds };
    },
  });
}

export function useCreateProductRelation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rel: {
      parent_product_id: string;
      child_product_id: string;
      relation_type: string;
      sort_order?: number;
    }) => {
      const { data, error } = await supabase
        .from("product_relations")
        .insert(rel)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product_relations"] });
      queryClient.invalidateQueries({ queryKey: ["product_relation_counts"] });
      toast.success("Связь добавлена");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useDeleteProductRelation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("product_relations")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product_relations"] });
      queryClient.invalidateQueries({ queryKey: ["product_relation_counts"] });
      toast.success("Связь удалена");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}

export function useUpdateProductRelation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; sort_order?: number; relation_type?: string }) => {
      const { data, error } = await supabase
        .from("product_relations")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product_relations"] });
      toast.success("Связь обновлена");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}
