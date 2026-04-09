/**
 * useModuleDisplayMeta — React Query hook that batch-resolves module display metadata
 * for an array of deals. Used by all deal-displaying components.
 */

import { useQuery } from "@tanstack/react-query";
import { resolveModuleDisplayMetaBatch, type ModuleDisplayMeta } from "@/lib/deals/resolveModuleDisplayMeta";

export function useModuleDisplayMeta(
  deals: Array<{ id: string; purchase_snapshot: unknown }> | null | undefined
) {
  return useQuery({
    queryKey: [
      "module-display-meta",
      deals?.map((d) => d.id).join(",") ?? "",
    ],
    queryFn: async () => {
      if (!deals || deals.length === 0) return new Map<string, ModuleDisplayMeta>();
      return resolveModuleDisplayMetaBatch(deals);
    },
    enabled: !!deals && deals.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
