import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
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
  // New fields for menu placement and display
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
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchModules = useCallback(async () => {
    try {
      setLoading(true);
      
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
      if (user) {
        const { data: subsData } = await supabase
          .from("subscriptions_v2")
          .select("tariff_id")
          .eq("user_id", user.id)
          .eq("status", "active");
        
        userTariffIds = subsData?.map(s => s.tariff_id) || [];
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
        const hasAccess = moduleAccess.length === 0 || 
          moduleAccess.some(a => userTariffIds.includes(a.tariff_id));

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
          has_access: hasAccess,
          accessible_tariffs: accessibleTariffs,
          accessible_products: accessibleProducts,
        };
      }) || [];

      setModules(enrichedModules);
    } catch (error) {
      console.error("Error fetching modules:", error);
      toast.error("Ошибка загрузки модулей");
    } finally {
      setLoading(false);
    }
  }, [user]);

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

      // Add tariff access if provided
      if (tariff_ids && tariff_ids.length > 0 && newModule) {
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

      // Update tariff access if provided
      if (tariff_ids !== undefined) {
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
