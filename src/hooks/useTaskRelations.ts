import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TaskDealLite {
  id: string;
  public_id: string | null;
  pipeline_id: string | null;
  pipeline_stage_id: string | null;
  status: string | null;
}

export interface TaskContactLite {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Batch-load deals and contacts referenced by tasks, for display in cards/list.
 * Returns maps keyed by id.
 */
export function useTaskRelations(dealIds: string[], contactIds: string[]) {
  const dealsQ = useQuery({
    queryKey: ["task-relations-deals", [...new Set(dealIds)].sort()],
    enabled: dealIds.length > 0,
    queryFn: async (): Promise<Record<string, TaskDealLite>> => {
      const ids = Array.from(new Set(dealIds));
      const { data, error } = await (supabase as any)
        .from("orders_v2")
        .select("id, public_id, pipeline_id, pipeline_stage_id, status")
        .in("id", ids);
      if (error) throw error;
      const map: Record<string, TaskDealLite> = {};
      for (const r of data ?? []) map[r.id] = r as TaskDealLite;
      return map;
    },
    staleTime: 60_000,
  });

  const contactsQ = useQuery({
    queryKey: ["task-relations-contacts", [...new Set(contactIds)].sort()],
    enabled: contactIds.length > 0,
    queryFn: async (): Promise<Record<string, TaskContactLite>> => {
      const ids = Array.from(new Set(contactIds));
      const { data, error } = await (supabase as any)
        .from("profiles")
        .select("id, full_name, email, phone")
        .in("id", ids);
      if (error) throw error;
      const map: Record<string, TaskContactLite> = {};
      for (const r of data ?? []) map[r.id] = r as TaskContactLite;
      return map;
    },
    staleTime: 60_000,
  });

  return {
    deals: dealsQ.data ?? {},
    contacts: contactsQ.data ?? {},
    isLoading: dealsQ.isLoading || contactsQ.isLoading,
  };
}
