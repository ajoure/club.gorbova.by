import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useActiveTrainingContentRules, resolveTrainingContentFilter, isModuleVisible } from "@/hooks/useTrainingContentRules";
import { toast } from "sonner";

export interface AccessibleProduct {
  product_name: string;
  tariff_count: number;
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
}

export function useTrainingModules() {
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [loading, setLoading] = useState(true);
  const isAdminUser = isAdmin();
  const hasLoadedOnceRef = useRef(false);
  const { data: tcData } = useActiveTrainingContentRules();
  const hasLoadedOnceRef = useRef(false);

  const fetchModules = useCallback(async () => {
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
      let userEntitlementProductIds = new Set<string>();
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
      let progressMap: Record<string, number> = {};
      if (user) {
        const { data: progressData } = await supabase
          .from("lesson_progress")
          .select("lesson_id, training_lessons(module_id)")
          .eq("user_id", user.id);

        progressData?.forEach(p => {
          const moduleId = (p.training_lessons as any)?.module_id;
          if (moduleId) {
            progressMap[moduleId] = (progressMap[moduleId] || 0) + 1;
          }
        });
      }

      // Combine data
      const enrichedModules = modulesData?.map(mod => {
        const lessonCount = lessonsData?.filter(l => l.module_id === mod.id).length || 0;
        const moduleAccess = accessData?.filter(a => a.module_id === mod.id) || [];
        const accessibleTariffs = moduleAccess.map(a => (a.tariffs as any)?.name || "");
        
        // Access precedence:
        // 1. admin bypass (applied below in normalizedModules)
        // 2. public module (no module_access entries) → true
        // 3. tariff-based: module_access ∩ subscriptions_v2 → true
        // 4. entitlement-based: module.product_id ∈ userEntitlementProductIds → true
        // module.product_id = null → entitlement path не применяется
        const baseAccess = 
          moduleAccess.length === 0 || 
          moduleAccess.some(a => userTariffIds.includes(a.tariff_id)) ||
          (mod.product_id != null && userEntitlementProductIds.has(mod.product_id));

        // Group by product for compact display
        const productMap: Record<string, { product_name: string; tariff_count: number }> = {};
        moduleAccess.forEach(a => {
          const productName = (a.tariffs as any)?.products_v2?.name || "Без продукта";
          if (!productMap[productName]) {
            productMap[productName] = { product_name: productName, tariff_count: 0 };
          }
          productMap[productName].tariff_count++;
        });
        const accessibleProducts: AccessibleProduct[] = Object.values(productMap);

        return {
          ...mod,
          lesson_count: lessonCount,
          completed_count: progressMap[mod.id] || 0,
          has_access: baseAccess, // Will be overridden for admins below
          accessible_tariffs: accessibleTariffs,
          accessible_products: accessibleProducts,
        };
      }) || [];

      // PATCH-1: Admin bypass — force has_access=true for all modules for admins
      // PATCH B: Apply training_content filter for non-admins
      const tcRules = tcData?.rules || [];
      const tcUserTariffIds = tcData?.userTariffIds || [];

      const normalizedModules = enrichedModules.map(m => {
        if (isAdminUser) return { ...m, has_access: true };
        if (!m.has_access) return m;

        // Apply training_content filter only for modules with confirmed access
        if (m.product_id && tcRules.length > 0) {
          // Find the root training for this module (parent_module_id = null means it IS root)
          const rootId = m.parent_module_id 
            ? enrichedModules.find(rm => rm.id === m.parent_module_id && !rm.parent_module_id)?.id || m.parent_module_id
            : m.id;
          
          const filter = resolveTrainingContentFilter(tcRules, rootId, m.product_id, tcUserTariffIds);
          if (filter && filter.mode === "partial") {
            // For root/container: check if this module or any child is allowed
            if (m.parent_module_id === null) {
              // Root module: keep visible (children will be filtered individually)
              return m;
            }
            // Child module: check if visible
            if (!isModuleVisible(filter, m.id)) {
              return { ...m, has_access: false, lesson_count: 0, completed_count: 0 };
            }
          }
        }
        return m;
      });

      // Hide empty containers (non-admin): modules with lesson_count=0 and no visible children
      const finalModules = normalizedModules.filter(m => {
        if (isAdminUser) return true;
        if (!m.has_access && m.parent_module_id !== null) return true; // Keep locked items visible
        // For root modules with partial filter: check if any children remain
        if (m.parent_module_id === null && m.lesson_count === 0) {
          const hasVisibleChildren = normalizedModules.some(
            child => child.parent_module_id === m.id && child.has_access && (child.lesson_count || 0) > 0
          );
          if (!hasVisibleChildren && m.has_access) {
            // Check if this root itself has visible lessons (no children case)
            // Keep it; individual lesson filtering happens in container hooks
          }
        }
        return true;
      });

      setModules(normalizedModules);
    } catch (error) {
      console.error("Error fetching modules:", error);
      toast.error("Ошибка загрузки модулей");
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isAdminUser]);

  useEffect(() => {
    fetchModules();
  }, [fetchModules]);

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
