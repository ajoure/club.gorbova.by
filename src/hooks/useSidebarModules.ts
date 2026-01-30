import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useMemo } from "react";

export interface SidebarModule {
  id: string;
  title: string;
  slug: string;
  menu_section_key: string | null;
  icon: string | null;
  sort_order: number;
  is_container?: boolean;
  has_access?: boolean;
  accessible_tariffs?: string[];
}

interface ModulesBySection {
  [sectionKey: string]: SidebarModule[];
}

/**
 * Fetches active training modules grouped by their menu_section_key
 * for dynamic sidebar navigation. Maps child keys to parent keys
 * so modules appear in the correct sidebar sections.
 * 
 * Access logic:
 * 1. Admins (super_admin, admin) → FULL ACCESS
 * 2. Modules without entries in module_access → PUBLIC (everyone)
 * 3. Modules with entries in module_access → check user's tariff_id
 */
export function useSidebarModules() {
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const isAdminUser = isAdmin();

  const { data, isLoading } = useQuery({
    queryKey: ["sidebar-modules", user?.id, isAdminUser],
    queryFn: async () => {
      // 1. Get all active modules
      const { data: modulesData, error: modulesError } = await supabase
        .from("training_modules")
        .select(`
          id,
          title,
          slug,
          menu_section_key,
          icon,
          sort_order,
          is_container
        `)
        .eq("is_active", true)
        .order("sort_order");

      if (modulesError) throw modulesError;

      // 2. Get ALL module_access records with tariff names
      const { data: allAccess } = await supabase
        .from("module_access")
        .select("module_id, tariff_id, tariffs(name)");

      // Group access by module_id with tariff IDs and names
      const accessByModule: Record<string, { tariffIds: string[]; tariffNames: string[] }> = {};
      allAccess?.forEach(a => {
        if (!accessByModule[a.module_id]) {
          accessByModule[a.module_id] = { tariffIds: [], tariffNames: [] };
        }
        accessByModule[a.module_id].tariffIds.push(a.tariff_id);
        const tariffName = (a.tariffs as any)?.name;
        if (tariffName) {
          accessByModule[a.module_id].tariffNames.push(tariffName);
        }
      });

      // 3. Get user's active tariff IDs if logged in
      let userTariffIds: string[] = [];
      if (user) {
        const { data: subs } = await supabase
          .from("subscriptions_v2")
          .select("tariff_id")
          .eq("user_id", user.id)
          .in("status", ["active", "trial"]);

        userTariffIds = subs?.map(s => s.tariff_id).filter(Boolean) || [];
      }

      // 4. Determine access for each module
      const modules = modulesData?.map(m => {
        const moduleAccess = accessByModule[m.id] || { tariffIds: [], tariffNames: [] };
        
        // Access logic:
        // - Admins always have access
        // - If no tariffs defined (empty array) → public module
        // - Otherwise check if user has any of the required tariffs
        const hasAccess = isAdminUser || 
          moduleAccess.tariffIds.length === 0 || 
          moduleAccess.tariffIds.some(tid => userTariffIds.includes(tid));

        return {
          ...m,
          has_access: hasAccess,
          accessible_tariffs: moduleAccess.tariffNames,
        };
      }) || [];

      return modules;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const modules = data || [];

  // Group modules by exact section key (no parent mapping)
  // Modules are displayed inside page tabs, not in sidebar dropdown
  const modulesBySection = useMemo<ModulesBySection>(() => {
    if (!modules.length) return {};

    return modules.reduce((acc, module) => {
      const key = module.menu_section_key || "products";
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(module);
      return acc;
    }, {} as ModulesBySection);
  }, [modules]);

  return {
    modules,
    modulesBySection,
    isLoading,
  };
}
