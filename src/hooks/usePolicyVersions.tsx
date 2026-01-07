import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface PolicyChange {
  type: "added" | "changed" | "removed";
  text: string;
}

export interface PolicyVersion {
  id: string;
  version: string;
  effective_date: string;
  summary: string | null;
  is_current: boolean;
  changes: PolicyChange[];
  created_at: string;
}

export function usePolicyVersions() {
  return useQuery({
    queryKey: ["policy-versions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("privacy_policy_versions")
        .select("*")
        .order("effective_date", { ascending: false });

      if (error) {
        console.error("Error fetching policy versions:", error);
        // Return fallback with initial version
        return [
          {
            id: "initial",
            version: "v2026-01-07",
            effective_date: "2026-01-07",
            summary: "Первоначальная версия политики конфиденциальности",
            is_current: true,
            changes: [],
            created_at: "2026-01-07T00:00:00Z",
          },
        ] as PolicyVersion[];
      }

      // Parse changes from JSON
      return (data || []).map((version) => ({
        ...version,
        changes: Array.isArray(version.changes) 
          ? (version.changes as unknown as PolicyChange[])
          : [],
      })) as PolicyVersion[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
