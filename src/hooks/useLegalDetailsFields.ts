/**
 * Shared hook for loading legal_details fields from fields_registry.
 * Single source of truth for both OrganizationDetailsForm and IndividualDetailsForm.
 *
 * Canonical token format: {{cf.legal_details.<public_id>}}
 * e.g. {{cf.legal_details.FLD-000042}}
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LegalDetailsFieldEntry {
  fieldId: string;       // UUID from fields_registry.id
  publicId: string;      // FLD-000042
  registryKey: string;   // legal_details.leg_unp
  columnName: string;    // leg_unp
  label: string;
  tokenString: string;   // {{cf.legal_details.FLD-000042}} — canonical format
}

export function useLegalDetailsFields() {
  const { data: fieldsMap, isLoading } = useQuery({
    queryKey: ["legal-details-fields-registry"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fields_registry")
        .select("id, key, label, public_id")
        .eq("entity_type", "legal_details")
        .is("archived_at", null)
        .order("display_order");

      if (error || !data) return new Map<string, LegalDetailsFieldEntry>();

      const map = new Map<string, LegalDetailsFieldEntry>();
      for (const f of data) {
        // Extract column name from namespaced key: "legal_details.leg_unp" → "leg_unp"
        const columnName = f.key.replace("legal_details.", "");
        map.set(columnName, {
          fieldId: f.id,
          publicId: f.public_id || "",
          registryKey: f.key,
          columnName,
          label: f.label,
          // Canonical token: through public_id, not UUID
          tokenString: f.public_id ? `{{cf.legal_details.${f.public_id}}}` : "",
        });
      }
      return map;
    },
    staleTime: 5 * 60 * 1000, // 5 min cache
  });

  return {
    /** Map from column name (e.g. "leg_unp") → field entry */
    fieldsMap: fieldsMap ?? new Map<string, LegalDetailsFieldEntry>(),
    isLoading,
  };
}
