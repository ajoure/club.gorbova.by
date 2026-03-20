/**
 * useGrpLookup — hook for legal entity lookup by UNP via grp-lookup edge function.
 * Works through GrpLookupAdapter (anti-corruption layer).
 */

import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeAndValidateUnp } from "@/lib/legal-entities/normalizeUnp";
import { GrpLookupAdapter } from "@/lib/legal-entities/adapters/GrpLookupAdapter";
import type { LegalEntityLookupResult } from "@/lib/legal-entities/types";

export function useGrpLookup() {
  return useMutation({
    mutationFn: async (unp: string): Promise<LegalEntityLookupResult> => {
      const normalized = normalizeAndValidateUnp(unp);
      if (!normalized) {
        return {
          found: false,
          status: "invalid",
          source: "direct",
          message: "УНП должен содержать ровно 9 цифр",
        };
      }

      const { data, error } = await supabase.functions.invoke("grp-lookup", {
        body: { unp: normalized },
      });

      if (error) {
        return {
          found: false,
          status: "unavailable",
          source: "direct",
          message: error.message || "Ошибка вызова сервиса",
        };
      }

      return GrpLookupAdapter.mapResponse(data);
    },
  });
}
