import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useActiveTrainingContentRules, resolveTrainingContentFilter, isModuleVisible as isModAllowed } from "@/hooks/useTrainingContentRules";
import { useModuleMonthGate } from "@/hooks/useModuleMonthGate";
import { useMemo } from "react";

export interface SidebarModule {
  id: string;
  title: string;
  slug: string;
  menu_section_key: string | null;
  icon: string | null;
  sort_order: number;
  is_container?: boolean;
  parent_module_id?: string | null;
  product_id?: string | null;
  content_month?: string | null;
  has_access?: boolean;
  /** True when has_access=true via tariff/product BUT month-gate failed. */
  month_locked?: boolean;
  /** YYYY-MM, populated when month_locked=true. */
  locked_month?: string | null;
  /** Tariff that grants access to this content_month. */
  required_tariff_id?: string | null;
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
  const { data: tcRawData, isLoading: tcLoading } = useActiveTrainingContentRules();
  const tcData = tcRawData && !Array.isArray(tcRawData) ? tcRawData : null;

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
          is_container,
          parent_module_id,
          product_id,
          content_month
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

      // PATCH v23.1.5: bulk-query entitlements for product-based access
      const userEntitlementProductIds = new Set<string>();
      if (user) {
        const { data: entsData } = await supabase
          .from("entitlements")
          .select("product_id, expires_at")
          .eq("user_id", user.id)
          .eq("status", "active");

        const now = new Date();
        (entsData || []).forEach(e => {
          if (e.product_id && (!e.expires_at || new Date(e.expires_at) > now)) {
            userEntitlementProductIds.add(e.product_id);
          }
        });
      }

      // Build parent product_id map for fallback
      const parentProductMap = new Map<string, string>();

      // 4. Determine access for each module
      // First pass: build parent product_id map
      modulesData?.forEach(m => {
        if ((m as any).product_id && !m.parent_module_id) {
          parentProductMap.set(m.id, (m as any).product_id);
        }
      });

      const modules = modulesData?.map(m => {
        const moduleAccess = accessByModule[m.id] || { tariffIds: [], tariffNames: [] };
        
        // Resolve effective product_id: own or fallback to parent
        const effectiveProductId = (m as any).product_id ?? 
          (m.parent_module_id ? parentProductMap.get(m.parent_module_id) : null) ?? null;

        // Access precedence:
        // For product-linked modules: admin → entitlement ONLY (legacy module_access excluded)
        // For non-product modules: admin → public → tariff (legacy path)
        let hasAccess: boolean;
        if (effectiveProductId != null) {
          // Product-linked: entitlement-only path (module_access excluded for cb20 etc.)
          hasAccess = isAdminUser || userEntitlementProductIds.has(effectiveProductId);
        } else {
          // Non-product-linked: legacy module_access path
          hasAccess = isAdminUser || 
            moduleAccess.tariffIds.length === 0 || 
            moduleAccess.tariffIds.some(tid => userTariffIds.includes(tid));
        }

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

  // PATCH B: Apply training_content filter for non-admins
  const filteredModules = useMemo(() => {
    // Guard: don't apply tc-filter while rules are still loading (prevents stale filter on refresh)
    if (isAdminUser || tcLoading || !tcData || !tcData.rules.length) return modules;

    const parentProductMap = new Map<string, string>();
    modules.forEach(m => {
      if (m.product_id && !m.parent_module_id) {
        parentProductMap.set(m.id, m.product_id);
      }
    });

    return modules.filter(m => {
      if (!m.has_access) return true; // Already no access, keep for lock display

      const effectiveProductId = m.product_id ?? 
        (m.parent_module_id ? parentProductMap.get(m.parent_module_id) : null) ?? null;

      if (!effectiveProductId) return true;

      // Find root training
      const rootId = m.parent_module_id 
        ? (modules.find(rm => rm.id === m.parent_module_id && !rm.parent_module_id)?.id || m.parent_module_id)
        : m.id;

      const filter = resolveTrainingContentFilter(tcData.rules, rootId, effectiveProductId, tcData.userTariffIds, tcData.entitlementTariffsByProduct || {});
      if (!filter || filter.mode === "full") return true;

      // For root modules: check if any children survived filtering
      if (!m.parent_module_id) {
        const hasVisibleChildren = modules.some(
          child => child.parent_module_id === m.id && child.has_access && isModAllowed(filter, child.id)
        );
        return hasVisibleChildren || isModAllowed(filter, m.id);
      }

      // Child module: check allowlist
      return isModAllowed(filter, m.id);
    });
  }, [modules, isAdminUser, tcData, tcLoading]);

  // Month-gate: collect modules with content_month + has_access=true (skip admin).
  const moduleMonthInputs = useMemo(() => {
    if (isAdminUser) return [];
    return filteredModules
      .filter((m: any) => m.has_access && m.content_month)
      .map((m: any) => ({
        module_id: m.id,
        content_month: m.content_month as string,
        parent_module_id: m.parent_module_id ?? null,
      }));
  }, [filteredModules, isAdminUser]);

  const { map: monthGateMap } = useModuleMonthGate(moduleMonthInputs);

  const monthGatedModules = useMemo<SidebarModule[]>(() => {
    if (isAdminUser || monthGateMap.size === 0) return filteredModules as SidebarModule[];
    return (filteredModules as SidebarModule[]).map((m) => {
      const gate = monthGateMap.get(m.id);
      if (!gate) return m;
      return {
        ...m,
        month_locked: true,
        locked_month: gate.locked_month,
        required_tariff_id: gate.required_tariff_id,
      };
    });
  }, [filteredModules, monthGateMap, isAdminUser]);

  // Group modules by exact section key
  const modulesBySection = useMemo<ModulesBySection>(() => {
    if (!monthGatedModules.length) return {};

    return monthGatedModules.reduce((acc, module) => {
      const key = module.menu_section_key || "products";
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(module);
      return acc;
    }, {} as ModulesBySection);
  }, [monthGatedModules]);

  return {
    modules: monthGatedModules,
    modulesBySection,
    isLoading,
  };
}
