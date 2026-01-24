import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useVisibilityPolling } from "./useVisibilityPolling";

export function useUnmappedProductsCount() {
  const visibilityInterval = useVisibilityPolling(60000);
  
  return useQuery({
    queryKey: ["bepaid-unmapped-count"],
    queryFn: async () => {
      // Get all queue items with raw_payload
      const { data: queue, error: queueError } = await supabase
        .from("payment_reconcile_queue")
        .select("raw_payload")
        .in("status", ["pending", "processing"]);

      if (queueError) return 0;

      // Get existing mappings
      const { data: existingMappings } = await supabase
        .from("bepaid_product_mappings" as any)
        .select("bepaid_plan_title");

      const mappedTitles = new Set((existingMappings || []).map((m: any) => m.bepaid_plan_title));

      // Count unique unmapped plan titles
      const unmappedTitles = new Set<string>();

      (queue || []).forEach(q => {
        const payload = q.raw_payload as Record<string, any> | null;
        if (!payload) return;

        const plan = payload.plan || {};
        const planTitle = plan.title || plan.name;

        if (planTitle && !mappedTitles.has(planTitle)) {
          unmappedTitles.add(planTitle);
        }
      });

      return unmappedTitles.size;
    },
    refetchInterval: visibilityInterval, // Pause when tab hidden
  });
}
