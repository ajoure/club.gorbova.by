import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface LinkedTraining {
  id: string;
  title: string;
  slug: string;
  public_id: string | null;
  is_active: boolean;
  is_container: boolean;
  parent_module_id: string | null;
  sort_order: number;
  product_id: string | null;
  lesson_count: number;
  children: LinkedTraining[];
}

export interface TrainingBindingDiagnostics {
  binding_source: "product_id" | "legacy_only" | "mixed_conflict" | "none";
  training_content_rules_count: number;
  legacy_module_access_count: number;
  has_conflict: boolean;
}

export interface RebindPreview {
  current_product: { id: string; name: string; public_id: string | null } | null;
  new_product: { id: string; name: string; public_id: string | null };
  descendant_count: number;
  lesson_count: number;
  training_content_rules_count: number;
  legacy_module_access_count: number;
  has_active_entitlements: boolean;
}

const QUERY_KEY = "product-linked-trainings";

/**
 * Fetches training modules linked to a product via training_modules.product_id (SoT).
 * Builds hierarchy: root → children, counts lessons.
 */
export function useProductTrainings(productId?: string) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: [QUERY_KEY, productId],
    queryFn: async () => {
      if (!productId) return { trainings: [], diagnostics: {} as Record<string, TrainingBindingDiagnostics> };

      // Fetch all modules for this product
      const { data: modules, error } = await supabase
        .from("training_modules")
        .select("id, title, slug, public_id, is_active, is_container, parent_module_id, sort_order, product_id")
        .eq("product_id", productId)
        .order("sort_order");
      if (error) throw error;

      // Fetch lesson counts per module
      const moduleIds = modules?.map(m => m.id) || [];
      let lessonCounts: Record<string, number> = {};
      if (moduleIds.length > 0) {
        const { data: lessons } = await supabase
          .from("training_lessons")
          .select("module_id")
          .in("module_id", moduleIds)
          .eq("is_active", true);
        lessons?.forEach(l => {
          lessonCounts[l.module_id] = (lessonCounts[l.module_id] || 0) + 1;
        });
      }

      // Fetch legacy module_access counts
      let legacyCounts: Record<string, number> = {};
      if (moduleIds.length > 0) {
        const { data: access } = await supabase
          .from("module_access")
          .select("module_id")
          .in("module_id", moduleIds);
        access?.forEach(a => {
          legacyCounts[a.module_id] = (legacyCounts[a.module_id] || 0) + 1;
        });
      }

      // Fetch training_content rules count for these modules
      let rulesCounts: Record<string, number> = {};
      if (moduleIds.length > 0) {
        const { data: rules } = await supabase
          .from("access_rules")
          .select("target_ref")
          .eq("grant_target_type", "training_content")
          .in("target_ref", moduleIds);
        rules?.forEach(r => {
          rulesCounts[r.target_ref] = (rulesCounts[r.target_ref] || 0) + 1;
        });
      }

      // Build tree
      const allModules: LinkedTraining[] = (modules || []).map(m => ({
        ...m,
        is_container: m.is_container ?? false,
        lesson_count: lessonCounts[m.id] || 0,
        children: [],
      }));

      const rootModules: LinkedTraining[] = [];
      const byId = new Map(allModules.map(m => [m.id, m]));

      allModules.forEach(m => {
        if (m.parent_module_id && byId.has(m.parent_module_id)) {
          byId.get(m.parent_module_id)!.children.push(m);
        } else if (!m.parent_module_id) {
          rootModules.push(m);
        }
      });

      // Build diagnostics per root module
      const diagnostics: Record<string, TrainingBindingDiagnostics> = {};
      rootModules.forEach(root => {
        const allIds = [root.id, ...root.children.map(c => c.id)];
        const legacyCount = allIds.reduce((sum, id) => sum + (legacyCounts[id] || 0), 0);
        const rulesCount = rulesCounts[root.id] || 0;

        diagnostics[root.id] = {
          binding_source: root.product_id ? (legacyCount > 0 ? "mixed_conflict" : "product_id") : (legacyCount > 0 ? "legacy_only" : "none"),
          training_content_rules_count: rulesCount,
          legacy_module_access_count: legacyCount,
          has_conflict: legacyCount > 0 && !!root.product_id,
        };
      });

      return { trainings: rootModules, diagnostics };
    },
    enabled: !!productId,
  });

  // Bind a free training to this product
  const bindTraining = useMutation({
    mutationFn: async ({ trainingId, productId: pid }: { trainingId: string; productId: string }) => {
      // Update root + all descendants
      const { error: rootErr } = await supabase
        .from("training_modules")
        .update({ product_id: pid } as any)
        .eq("id", trainingId);
      if (rootErr) throw rootErr;

      const { error: childErr } = await supabase
        .from("training_modules")
        .update({ product_id: pid } as any)
        .eq("parent_module_id", trainingId);
      if (childErr) throw childErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success("Тренинг привязан к продукту");
    },
    onError: () => toast.error("Ошибка привязки тренинга"),
  });

  // Unbind training from product
  const unbindTraining = useMutation({
    mutationFn: async (trainingId: string) => {
      // Check for active training_content rules
      const { data: activeRules } = await supabase
        .from("access_rules")
        .select("id")
        .eq("grant_target_type", "training_content")
        .eq("target_ref", trainingId)
        .eq("is_active", true);

      if (activeRules && activeRules.length > 0) {
        throw new Error("ACTIVE_RULES_EXIST");
      }

      const { error: rootErr } = await supabase
        .from("training_modules")
        .update({ product_id: null } as any)
        .eq("id", trainingId);
      if (rootErr) throw rootErr;

      const { error: childErr } = await supabase
        .from("training_modules")
        .update({ product_id: null } as any)
        .eq("parent_module_id", trainingId);
      if (childErr) throw childErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success("Тренинг отвязан от продукта");
    },
    onError: (e: any) => {
      if (e?.message === "ACTIVE_RULES_EXIST") {
        toast.error("Невозможно отвязать: есть активные правила доступа к контенту. Сначала деактивируйте их.");
      } else {
        toast.error("Ошибка отвязки тренинга");
      }
    },
  });

  // Get rebind preview
  const getRebindPreview = async (trainingId: string, newProductId: string): Promise<RebindPreview> => {
    // Current training
    const { data: training } = await supabase
      .from("training_modules")
      .select("id, product_id")
      .eq("id", trainingId)
      .single();

    let currentProduct = null;
    if (training?.product_id) {
      const { data: cp } = await supabase
        .from("products_v2")
        .select("id, name, public_id")
        .eq("id", training.product_id)
        .single();
      currentProduct = cp;
    }

    const { data: np } = await supabase
      .from("products_v2")
      .select("id, name, public_id")
      .eq("id", newProductId)
      .single();

    // Descendants
    const { data: descendants } = await supabase
      .from("training_modules")
      .select("id")
      .eq("parent_module_id", trainingId);

    const allIds = [trainingId, ...(descendants?.map(d => d.id) || [])];

    // Lessons
    const { data: lessons } = await supabase
      .from("training_lessons")
      .select("id")
      .in("module_id", allIds);

    // Active training_content rules
    const { data: rules } = await supabase
      .from("access_rules")
      .select("id")
      .eq("grant_target_type", "training_content")
      .eq("target_ref", trainingId)
      .eq("is_active", true);

    // Legacy module_access
    const { data: legacyAccess } = await supabase
      .from("module_access")
      .select("id")
      .in("module_id", allIds);

    // Active entitlements on current product
    let hasEntitlements = false;
    if (training?.product_id) {
      const { data: ents } = await supabase
        .from("entitlements")
        .select("id")
        .eq("product_id", training.product_id)
        .eq("status", "active")
        .limit(1);
      hasEntitlements = (ents?.length || 0) > 0;
    }

    return {
      current_product: currentProduct,
      new_product: np!,
      descendant_count: descendants?.length || 0,
      lesson_count: lessons?.length || 0,
      training_content_rules_count: rules?.length || 0,
      legacy_module_access_count: legacyAccess?.length || 0,
      has_active_entitlements: hasEntitlements,
    };
  };

  // Execute rebind
  const rebindTraining = useMutation({
    mutationFn: async ({ trainingId, newProductId }: { trainingId: string; newProductId: string }) => {
      // Get current state for audit
      const { data: training } = await supabase
        .from("training_modules")
        .select("id, product_id, title")
        .eq("id", trainingId)
        .single();

      const oldProductId = training?.product_id;

      // Deactivate training_content rules of old product
      const { data: deactivatedRules } = await supabase
        .from("access_rules")
        .update({ is_active: false } as any)
        .eq("grant_target_type", "training_content")
        .eq("target_ref", trainingId)
        .eq("is_active", true)
        .select("id");

      // Update root
      const { error: rootErr } = await supabase
        .from("training_modules")
        .update({ product_id: newProductId } as any)
        .eq("id", trainingId);
      if (rootErr) throw rootErr;

      // Update all descendants
      const { error: childErr } = await supabase
        .from("training_modules")
        .update({ product_id: newProductId } as any)
        .eq("parent_module_id", trainingId);
      if (childErr) throw childErr;

      // Audit log
      await supabase.from("audit_logs").insert({
        action: "training.rebind.executed",
        actor_type: "admin",
        meta: {
          training_id: trainingId,
          training_title: training?.title,
          old_product_id: oldProductId,
          new_product_id: newProductId,
          deactivated_rule_ids: deactivatedRules?.map(r => r.id) || [],
          deactivated_rules_count: deactivatedRules?.length || 0,
        },
      } as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success("Тренинг перепривязан к другому продукту");
    },
    onError: () => toast.error("Ошибка перепривязки тренинга"),
  });

  return {
    trainings: data?.trainings || [],
    diagnostics: data?.diagnostics || {},
    isLoading,
    bindTraining: bindTraining.mutateAsync,
    unbindTraining: unbindTraining.mutateAsync,
    rebindTraining: rebindTraining.mutateAsync,
    getRebindPreview,
    isBinding: bindTraining.isPending,
  };
}

/**
 * Fetches free trainings (product_id IS NULL) for binding selector.
 * Also fetches trainings from other products for rebind scenario.
 */
export function useAvailableTrainingsForBind(currentProductId?: string) {
  return useQuery({
    queryKey: ["available-trainings-for-bind", currentProductId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_modules")
        .select("id, title, slug, public_id, is_active, product_id, parent_module_id, sort_order")
        .is("parent_module_id", null)
        .order("is_active", { ascending: false })
        .order("sort_order");
      if (error) throw error;

      const free = (data || []).filter(m => !m.product_id);
      const currentProduct = (data || []).filter(m => m.product_id === currentProductId);
      const otherProduct = (data || []).filter(m => m.product_id && m.product_id !== currentProductId);

      return { free, currentProduct, otherProduct, all: data || [] };
    },
    enabled: !!currentProductId,
  });
}
