import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SectionAccessRule {
  rule_id: string;
  product_id: string | null;
  product_name: string | null;
  product_slug: string | null;
  tariff_id: string | null;
  tariff_name: string | null;
  tariff_public_id: string | null;
  target_label: string | null;
}

export interface SectionCatalogData {
  section_code: string;
  section_label: string;
  short_description: string | null;
  features_json: string[];
  cta_label: string | null;
  is_active: boolean;
  is_public: boolean;
  available_via_rules: SectionAccessRule[];
}

/**
 * Fetches section catalog data for locked-screen:
 * - section description & features
 * - ALL active access rules (products/tariffs) that grant access
 */
export function useSectionCatalog(sectionCode: string | null) {
  return useQuery({
    queryKey: ["section-catalog", sectionCode],
    queryFn: async (): Promise<SectionCatalogData | null> => {
      if (!sectionCode) return null;

      const { data, error } = await supabase.rpc("get_section_access_catalog", {
        p_section_code: sectionCode,
      });

      if (error) {
        console.error("[useSectionCatalog] RPC error:", error);
        throw error;
      }

      if (!data) return null;

      // RPC returns jsonb, parse it
      const parsed = typeof data === "string" ? JSON.parse(data) : data;

      return {
        section_code: parsed.section_code,
        section_label: parsed.section_label,
        short_description: parsed.short_description,
        features_json: Array.isArray(parsed.features_json) ? parsed.features_json : [],
        cta_label: parsed.cta_label,
        is_active: parsed.is_active,
        is_public: parsed.is_public,
        available_via_rules: Array.isArray(parsed.available_via_rules)
          ? parsed.available_via_rules
          : [],
      } as SectionCatalogData;
    },
    enabled: !!sectionCode,
    staleTime: 5 * 60 * 1000,
  });
}
