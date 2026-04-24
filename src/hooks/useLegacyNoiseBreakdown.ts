import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildLegacyNoiseBreakdown } from "@/lib/system-health/legacy-noise-config";

// Hook для legacy-noise: строгий фильтр decision='exclude' AND note ILIKE '%source_invariant=%'
export function useLegacyNoiseBreakdown() {
  return useQuery({
    queryKey: ["system-health-legacy-noise"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_health_discovery_findings")
        .select("decision, note")
        .eq("decision", "exclude")
        .ilike("note", "%source_invariant=%")
        .limit(2000);
      if (error) {
        if (error.code === "42501" || error.message.includes("permission")) {
          return { total: 0, bySourceInvariant: [] };
        }
        throw error;
      }
      return buildLegacyNoiseBreakdown(data || []);
    },
  });
}
