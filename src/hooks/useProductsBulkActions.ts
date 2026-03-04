import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface DryRunResult {
  product_id: string;
  can_delete: boolean;
  reasons: string[];
}

export function useBulkDeleteDryRun() {
  return useMutation({
    mutationFn: async (productIds: string[]) => {
      const { data, error } = await supabase.rpc("products_bulk_delete_dryrun", {
        product_ids: productIds,
      });
      if (error) throw error;
      return (data || []) as DryRunResult[];
    },
  });
}

export function useBulkDeleteExecute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (productIds: string[]) => {
      const { data, error } = await supabase.rpc("products_bulk_delete_execute", {
        product_ids: productIds,
        actor_label: "bulk_delete_products",
      });
      if (error) throw error;
      return data as { requested: number; deleted: number; deleted_ids: string[] };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["products_v2"] });
      queryClient.invalidateQueries({ queryKey: ["product_relation_counts"] });
      toast.success(`Удалено продуктов: ${result.deleted} из ${result.requested}`);
    },
    onError: (error) => {
      toast.error(`Ошибка удаления: ${error.message}`);
    },
  });
}

export function useBulkStatusChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      const { error } = await supabase
        .from("products_v2")
        .update({ status, updated_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;

      // Audit log
      await supabase.from("audit_logs").insert({
        action: "bulk_status_change_products",
        actor_type: "system",
        actor_user_id: null,
        actor_label: "bulk_status_change",
        meta: { count: ids.length, new_status: status },
      });

      return { count: ids.length, status };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["products_v2"] });
      const labels: Record<string, string> = {
        active: "активными",
        hidden: "скрытыми",
        archived: "архивными",
      };
      toast.success(`${result.count} продуктов сделано ${labels[result.status] || result.status}`);
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });
}
