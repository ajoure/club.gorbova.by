import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useActiveTrainingContentRules, resolveTrainingContentFilter, isModuleVisible } from "@/hooks/useTrainingContentRules";
import { toast } from "sonner";

export interface AccessibleProduct {
  product_name: string;
  tariff_count: number;
}

interface ModuleAccessTariffInfo {
  name?: string | null;
  product_id?: string | null;
  products_v2?: { name?: string | null } | null;
}

export interface TrainingModule {
  id: string;
  product_id: string | null;
  title: string;
  slug: string;
  description: string | null;
  cover_image: string | null;
  icon: string;
  color_gradient: string;
  sort_order: number;
  is_active: boolean;
  content_month?: string | null;
  created_at: string;
  updated_at: string;
  // Hierarchy
  parent_module_id: string | null;
  is_container?: boolean;
  // Menu placement and display
  menu_section_key: string | null;
  display_layout: string | null;
  // Computed fields
  lesson_count?: number;
  completed_count?: number;
  has_access?: boolean;
  accessible_tariffs?: string[];
  accessible_products?: AccessibleProduct[];
}

export interface TrainingModuleFormData {
  product_id?: string | null;
  title: string;
  slug: string;
  description?: string;
  cover_image?: string;
  icon?: string;
  color_gradient?: string;
  sort_order?: number;
  is_active?: boolean;
  tariff_ids?: string[];
  // New fields
  menu_section_key?: string;
  display_layout?: string;
  content_month?: string | null;
}

export function useTrainingModules() {
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [loading, setLoading] = useState(true);
  const isAdminUser = isAdmin();
  const hasLoadedOnceRef = useRef(false);
  const fetchIdRef = useRef(0);
  const { data: tcRawData, isLoading: tcLoading } = useActiveTrainingContentRules();
  const tcData = tcRawData && !Array.isArray(tcRawData) ? tcRawData : null;

  // Stable fingerprint for tcData to avoid unnecessary refetches when object reference changes
  const tcFingerprint = useMemo(() => {
    if (!tcData) return "null";
    const ruleIds = tcData.rules.map(r => r.id).sort().join(",");
    const tariffIds = [...(tcData.userTariffIds || [])].sort().join(",");
    return `${ruleIds}|${tariffIds}`;
  }, [tcData]);

  const fetchModules = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    try {
      // Only show loading on initial fetch — background refetch must NOT collapse DOM
      if (!hasLoadedOnceRef.current) {
        setLoading(true);
      }
      // Fetch modules
      const { data: modulesData, error: modulesError } = await supabase
        .from("training_modules")
        .select("*")
        .order("sort_order", { ascending: true });

      if (modulesError) throw modulesError;

      // Fetch lesson counts per module
      const { data: lessonsData } = await supabase
        .from("training_lessons")
        .select("module_id")
        .eq("is_active", true);

      // Fetch module access (tariffs with product info)
      const { data: accessData } = await supabase
        .from("module_access")
        .select("module_id, tariff_id, tariffs(name, product_id, products_v2(name))");

      // Fetch user subscriptions if logged in
      let userTariffIds: string[] = [];
      const userEntitlementProductIds = new Set<string>();
      if (user) {
        const { data: subsData } = await supabase
          .from("subscriptions_v2")
          .select("tariff_id")
          .eq("user_id", user.id)
          .eq("status", "active");
        
        userTariffIds = subsData?.map(s => s.tariff_id) || [];

        // PATCH v23.1.5: bulk-query entitlements for product-based access
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

      // Fetch user progress
      const progressMap: Record<string, number> = {};
      if (user) {
        const { data: progressData } = await supabase
          .from("lesson_progress")
          .select("lesson_id, training_lessons(module_id)")
          .eq("user_id", user.id);

        progressData?.forEach(p => {
          const lesson = p.training_lessons as { module_id?: string | null } | null;
          const moduleId = lesson?.module_id;
          if (moduleId) {
            progressMap[moduleId] = (progressMap[moduleId] || 0) + 1;
          }
        });
      }

      // Build direct lesson count map
      const directLessonCount: Record<string, number> = {};
      lessonsData?.forEach(l => {
        directLessonCount[l.module_id] = (directLessonCount[l.module_id] || 0) + 1;
      });

      // Build adjacency map for recursive counting (parent → children)
      const childrenMap: Record<string, string[]> = {};
      modulesData?.forEach(mod => {
        if (mod.parent_module_id) {
          if (!childrenMap[mod.parent_module_id]) childrenMap[mod.parent_module_id] = [];
          childrenMap[mod.parent_module_id].push(mod.id);
        }
      });

      // Iterative BFS to compute recursive lesson count for any module
      const computeRecursiveLessonCount = (rootId: string): number => {
        let total = directLessonCount[rootId] || 0;
        const queue = [...(childrenMap[rootId] || [])];
        const visited = new Set<string>([rootId]);
        while (queue.length > 0) {
          const nodeId = queue.shift()!;
          if (visited.has(nodeId)) continue;
          visited.add(nodeId);
          // Only count active modules
          const nodeModule = modulesData?.find(m => m.id === nodeId);
          if (!nodeModule?.is_active) continue;
          total += directLessonCount[nodeId] || 0;
          const nodeChildren = childrenMap[nodeId] || [];
          queue.push(...nodeChildren);
        }
        return total;
      };

      // Combine data
      const enrichedModules = modulesData?.map(mod => {
        const lessonCount = directLessonCount[mod.id] || 0;
        const recursiveLessonCount = computeRecursiveLessonCount(mod.id);
        const moduleAccess = accessData?.filter(a => a.module_id === mod.id) || [];
        const accessibleTariffs = moduleAccess.map(a => (a.tariffs as ModuleAccessTariffInfo | null)?.name || "");
        
        // Phase F fix: Access precedence for product-linked modules
        // If module has product_id, use ONLY entitlement path (not legacy module_access)
        // module_access is secondary fallback ONLY for modules without product_id
        let baseAccess: boolean;
        if (mod.product_id != null) {
          // Product-linked: entitlement-only path (module_access excluded)
          baseAccess = userEntitlementProductIds.has(mod.product_id);
        } else {
          // Non-product-linked: legacy module_access path
          baseAccess = moduleAccess.length === 0 || 
            moduleAccess.some(a => userTariffIds.includes(a.tariff_id));
        }

        // Group by product for compact display
        const productMap: Record<string, { product_name: string; tariff_count: number }> = {};
        moduleAccess.forEach(a => {
          const tariff = a.tariffs as ModuleAccessTariffInfo | null;
          const productName = tariff?.products_v2?.name || "Без продукта";
          if (!productMap[productName]) {
            productMap[productName] = { product_name: productName, tariff_count: 0 };
          }
          productMap[productName].tariff_count++;
        });
        const accessibleProducts: AccessibleProduct[] = Object.values(productMap);

        return {
          ...mod,
          lesson_count: lessonCount,
          recursive_lesson_count: recursiveLessonCount,
          completed_count: progressMap[mod.id] || 0,
          has_access: baseAccess,
          accessible_tariffs: accessibleTariffs,
          accessible_products: accessibleProducts,
        };
      }) || [];

      // PATCH-1: Admin bypass — force has_access=true for all modules for admins
      // PATCH B: Apply training_content filter for non-admins
      const tcRules = tcData?.rules || [];
      const tcUserTariffIds = tcData?.userTariffIds || [];
      const tcEntTariffsByProduct = tcData?.entitlementTariffsByProduct || {};
      const tcManualEntProducts = (tcData as any)?.productsWithManualEnt || [];

      // Build parent product_id map for inheritance
      const parentProductMap = new Map<string, string>();
      enrichedModules.forEach(m => {
        if (m.product_id && !m.parent_module_id) {
          parentProductMap.set(m.id, m.product_id);
        }
      });

      const normalizedModules = enrichedModules.map(m => {
        if (isAdminUser) return { ...m, has_access: true };
        
        // Inherit access from parent for child modules with same product_id
        if (!m.has_access && m.parent_module_id) {
          const parentProdId = parentProductMap.get(m.parent_module_id);
          if (parentProdId && m.product_id === parentProdId) {
            const parentMod = enrichedModules.find(p => p.id === m.parent_module_id);
            if (parentMod?.has_access) {
              m = { ...m, has_access: true };
            }
          }
        }
        
        if (!m.has_access) return m;

        // Apply training_content filter only for modules with confirmed access
        if (m.product_id && tcRules.length > 0) {
          const rootId = m.parent_module_id 
            ? enrichedModules.find(rm => rm.id === m.parent_module_id && !rm.parent_module_id)?.id || m.parent_module_id
            : m.id;
          
          const filter = resolveTrainingContentFilter(tcRules, rootId, m.product_id, tcUserTariffIds, tcEntTariffsByProduct, tcManualEntProducts);
          if (filter && filter.mode === "partial") {
            if (m.parent_module_id === null) {
              return m; // Root: keep visible, children filtered individually
            }
            if (!isModuleVisible(filter, m.id)) {
              return { ...m, has_access: false, lesson_count: 0, completed_count: 0 };
            }
          }
        }
        return m;
      });

      // Phase E: Compute visible recursive lesson count based on effective scope
      const visibleModuleIds = new Set(normalizedModules.filter(m => m.has_access).map(m => m.id));
      
      const computeVisibleRecursiveLessonCount = (rootId: string): number => {
        let total = directLessonCount[rootId] || 0;
        const queue = [...(childrenMap[rootId] || [])];
        const visited = new Set<string>([rootId]);
        while (queue.length > 0) {
          const nodeId = queue.shift()!;
          if (visited.has(nodeId)) continue;
          visited.add(nodeId);
          // Only count modules that are visible in effective scope
          if (!visibleModuleIds.has(nodeId)) continue;
          const nodeModule = modulesData?.find(m => m.id === nodeId);
          if (!nodeModule?.is_active) continue;
          total += directLessonCount[nodeId] || 0;
          queue.push(...(childrenMap[nodeId] || []));
        }
        return total;
      };

      // Phase E: Hide root modules with empty effective scope (not "0 уроков")
      const finalModules = normalizedModules.filter(m => {
        if (isAdminUser) return true;
        // Keep locked child items visible (for lock display)
        if (!m.has_access && m.parent_module_id !== null) return true;
        // Root module with access: hide if effective scope is empty
        if (m.parent_module_id === null && m.has_access) {
          const visibleRecursive = computeVisibleRecursiveLessonCount(m.id);
          if (visibleRecursive === 0) {
            // Phase E STOP-guard: empty scope = "нет доступа", not "0 уроков"
            return false;
          }
        }
        return true;
      });

      // Recalc root lesson_count/completed_count from visible children (recursive)
      finalModules.forEach(m => {
        if (isAdminUser || m.parent_module_id !== null || !m.has_access) return;
        const visibleRecursive = computeVisibleRecursiveLessonCount(m.id);
        if (visibleRecursive > 0) {
          m.lesson_count = visibleRecursive;
          // Recalc completed from visible children
          const visibleChildren = finalModules.filter(
            c => c.parent_module_id === m.id && c.has_access
          );
          m.completed_count = visibleChildren.reduce((s, c) => s + (c.completed_count || 0), 0);
        }
      });

      // Race guard: discard stale fetch results
      if (fetchId !== fetchIdRef.current) return;
      setModules(finalModules);
    } catch (error) {
      if (fetchId !== fetchIdRef.current) return;
      console.error("Error fetching modules:", error);
      toast.error("Ошибка загрузки модулей");
    } finally {
      if (fetchId === fetchIdRef.current) {
        hasLoadedOnceRef.current = true;
        setLoading(false);
      }
    }
  // tcFingerprint ensures refetch when training content rules load (fixes stale closure on refresh)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isAdminUser, tcFingerprint]);

  useEffect(() => {
    // Gate: don't fetch until tcData is resolved (not still loading) for non-admins
    // tcData === null is valid (user without rules), but tcLoading === true means still fetching
    if (!isAdminUser && tcLoading) return;
    fetchModules();
  }, [fetchModules, isAdminUser, tcLoading]);

  const createModule = async (data: TrainingModuleFormData): Promise<boolean> => {
    try {
      const { tariff_ids, ...moduleData } = data;
      
      const { data: newModule, error } = await supabase
        .from("training_modules")
        .insert(moduleData)
        .select()
        .single();

      if (error) throw error;

      // PATCH v23.1.6: Skip module_access write if module has product_id
      // Access is managed via product SoT for product-linked modules
      const effectiveProductId = data.product_id || newModule?.product_id;
      if (!effectiveProductId && tariff_ids && tariff_ids.length > 0 && newModule) {
        const accessRecords = tariff_ids.map(tariffId => ({
          module_id: newModule.id,
          tariff_id: tariffId,
        }));
        
        const { error: accessError } = await supabase
          .from("module_access")
          .insert(accessRecords);

        if (accessError) throw accessError;
      }

      toast.success("Модуль создан");
      await fetchModules();
      return true;
    } catch (error) {
      console.error("Error creating module:", error);
      toast.error("Ошибка создания модуля");
      return false;
    }
  };

  const updateModule = async (id: string, data: Partial<TrainingModuleFormData>): Promise<boolean> => {
    try {
      const { tariff_ids, ...moduleData } = data;
      
      const { error } = await supabase
        .from("training_modules")
        .update(moduleData)
        .eq("id", id);

      if (error) throw error;

      // PATCH v23.1.6: Check effective product_id — skip module_access for product-linked modules
      const effectiveProductId = data.product_id ?? modules.find(m => m.id === id)?.product_id;

      // Update tariff access if provided and module is NOT product-linked
      if (tariff_ids !== undefined && !effectiveProductId) {
        // Remove existing access
        await supabase
          .from("module_access")
          .delete()
          .eq("module_id", id);

        // Add new access
        if (tariff_ids.length > 0) {
          const accessRecords = tariff_ids.map(tariffId => ({
            module_id: id,
            tariff_id: tariffId,
          }));
          
          await supabase
            .from("module_access")
            .insert(accessRecords);
        }
      }

      toast.success("Модуль обновлён");
      await fetchModules();
      return true;
    } catch (error) {
      console.error("Error updating module:", error);
      toast.error("Ошибка обновления модуля");
      return false;
    }
  };

  const deleteModule = async (id: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from("training_modules")
        .delete()
        .eq("id", id);

      if (error) throw error;

      toast.success("Модуль удалён");
      await fetchModules();
      return true;
    } catch (error) {
      console.error("Error deleting module:", error);
      toast.error("Ошибка удаления модуля");
      return false;
    }
  };

  return {
    modules,
    loading,
    refetch: fetchModules,
    createModule,
    updateModule,
    deleteModule,
  };
}
