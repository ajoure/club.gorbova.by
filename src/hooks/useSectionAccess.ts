import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface SectionAccessEntry {
  section_code: string;
  section_id: string;
  section_label: string;
  section_route: string;
  is_public: boolean;
  has_access: boolean;
  granted_via_product_id: string | null;
  granted_via_product_name: string | null;
  granted_via_tariff_id: string | null;
  granted_via_tariff_name: string | null;
}

interface UseSectionAccessResult {
  sections: SectionAccessEntry[];
  isLoading: boolean;
  isError: boolean;
  /** Check access for a specific section code */
  checkAccess: (sectionCode: string) => {
    found: boolean;
    is_public: boolean;
    has_access: boolean;
    section_label: string;
    granted_via_product_name: string | null;
    granted_via_tariff_name: string | null;
  };
  /** Kill-switch: if false, gating is disabled globally */
  gatingEnabled: boolean;
}

/**
 * Hook to check section access via get_user_section_access RPC.
 * Admin bypass: admins always get has_access=true (handled by RPC itself).
 * Kill-switch: reads app_settings.section_gating_enabled; if false, all sections treated as public.
 */
export function useSectionAccess(): UseSectionAccessResult {
  const { user, role } = useAuth();
  const isAdmin = role === "admin" || role === "superadmin";

  // Kill-switch from app_settings
  const { data: gatingEnabled = true } = useQuery({
    queryKey: ["app-settings", "section_gating_enabled"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "section_gating_enabled")
        .maybeSingle();
      if (error || !data) return true; // default: enabled
      return data.value === true || data.value === "true";
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: sections = [], isLoading, isError } = useQuery({
    queryKey: ["section-access", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_user_section_access", {
        p_user_id: user!.id,
      });
      if (error) throw error;
      return (data || []) as SectionAccessEntry[];
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000,
  });

  const checkAccess = (sectionCode: string) => {
    const entry = sections.find((s) => s.section_code === sectionCode);
    if (!entry) {
      return {
        found: false,
        is_public: true,
        has_access: true,
        section_label: "",
        granted_via_product_name: null,
        granted_via_tariff_name: null,
      };
    }

    // Kill-switch off → treat everything as public
    if (!gatingEnabled) {
      return {
        found: true,
        is_public: true,
        has_access: true,
        section_label: entry.section_label,
        granted_via_product_name: entry.granted_via_product_name,
        granted_via_tariff_name: entry.granted_via_tariff_name,
      };
    }

    // Admin early bypass (RPC should already handle this, but safe shortcut)
    if (isAdmin) {
      return {
        found: true,
        is_public: entry.is_public,
        has_access: true,
        section_label: entry.section_label,
        granted_via_product_name: entry.granted_via_product_name,
        granted_via_tariff_name: entry.granted_via_tariff_name,
      };
    }

    return {
      found: true,
      is_public: entry.is_public,
      has_access: entry.has_access,
      section_label: entry.section_label,
      granted_via_product_name: entry.granted_via_product_name,
      granted_via_tariff_name: entry.granted_via_tariff_name,
    };
  };

  return { sections, isLoading, isError, checkAccess, gatingEnabled };
}
