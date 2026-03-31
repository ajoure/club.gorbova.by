import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// === Types ===

export interface TrainingContentConditions {
  access_mode: "full" | "partial";
  allowed_module_ids: string[];
  allowed_lesson_ids: string[];
  rule_purpose?: string;
}

export interface TrainingContentRule {
  id: string;
  product_id: string | null;
  tariff_id: string | null;
  target_ref: string; // root training module id
  target_label: string | null;
  is_active: boolean;
  conditions: TrainingContentConditions;
  notes: string | null;
}

export interface TrainingContentFilter {
  mode: "full" | "partial";
  allowedModuleIds: Set<string>;
  allowedLessonIds: Set<string>;
}

// === Tree for picker ===

export interface TreeModule {
  id: string;
  title: string;
  public_id: string | null;
  is_active: boolean;
  sort_order: number;
  parent_module_id: string | null;
  children: TreeModule[];
  lessons: TreeLesson[];
}

export interface TreeLesson {
  id: string;
  title: string;
  module_id: string;
  sort_order: number;
  is_active: boolean;
}

/**
 * Loads full tree (modules + lessons) for a root training module.
 * Used in the wizard tree-picker for partial access configuration.
 */
export function useTrainingContentTree(trainingId?: string) {
  return useQuery({
    queryKey: ["training-content-tree", trainingId],
    queryFn: async () => {
      if (!trainingId) return null;

      // Get all descendant modules (including root)
      const { data: modules, error: modError } = await supabase
        .from("training_modules")
        .select("id, title, public_id, is_active, sort_order, parent_module_id")
        .or(`id.eq.${trainingId},parent_module_id.eq.${trainingId}`)
        .order("sort_order");

      if (modError) throw modError;

      // Also get grandchildren (depth 2)
      const childIds = (modules || []).filter(m => m.parent_module_id === trainingId).map(m => m.id);
      let allModules = modules || [];

      if (childIds.length > 0) {
        const { data: grandchildren } = await supabase
          .from("training_modules")
          .select("id, title, public_id, is_active, sort_order, parent_module_id")
          .in("parent_module_id", childIds)
          .order("sort_order");
        if (grandchildren) {
          allModules = [...allModules, ...grandchildren];
        }
      }

      // Get all module IDs for lesson query
      const allModuleIds = allModules.map(m => m.id);

      // Get lessons
      const { data: lessons, error: lesError } = await supabase
        .from("training_lessons")
        .select("id, title, module_id, sort_order, is_active")
        .in("module_id", allModuleIds)
        .order("sort_order");

      if (lesError) throw lesError;

      // Build tree
      const lessonsByModule: Record<string, TreeLesson[]> = {};
      (lessons || []).forEach(l => {
        if (!lessonsByModule[l.module_id]) lessonsByModule[l.module_id] = [];
        lessonsByModule[l.module_id].push(l);
      });

      const buildNode = (mod: typeof allModules[0]): TreeModule => {
        const children = allModules
          .filter(m => m.parent_module_id === mod.id)
          .map(buildNode);
        return {
          ...mod,
          children,
          lessons: lessonsByModule[mod.id] || [],
        };
      };

      const root = allModules.find(m => m.id === trainingId);
      if (!root) return null;

      return buildNode(root);
    },
    enabled: !!trainingId,
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Loads training_content rules for a specific product (admin view).
 */
export function useTrainingContentRulesForProduct(productId?: string) {
  return useQuery({
    queryKey: ["training-content-rules", productId],
    queryFn: async () => {
      if (!productId) return [];

      const { data, error } = await supabase
        .from("access_rules")
        .select("id, product_id, tariff_id, target_ref, target_label, is_active, conditions, notes")
        .eq("grant_target_type", "training_content")
        .eq("product_id", productId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data || []).map(r => ({
        ...r,
        conditions: (r.conditions as unknown as TrainingContentConditions) || { access_mode: "full", allowed_module_ids: [], allowed_lesson_ids: [] },
      })) as TrainingContentRule[];
    },
    enabled: !!productId,
  });
}

/**
 * Loads active training_content rules relevant to the current user.
 * Used in runtime hooks for filtering.
 */
export function useActiveTrainingContentRules() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["active-training-content-rules", user?.id],
    queryFn: async () => {
      if (!user) return [];

      // Get user's active product IDs (from entitlements)
      const { data: ents } = await supabase
        .from("entitlements")
        .select("product_id")
        .eq("user_id", user.id)
        .eq("status", "active");

      const productIds = [...new Set((ents || []).map(e => e.product_id).filter(Boolean))] as string[];

      // Get user's active tariff IDs
      const { data: subs } = await supabase
        .from("subscriptions_v2")
        .select("tariff_id")
        .eq("user_id", user.id)
        .in("status", ["active", "trial"]);

      const tariffIds = (subs || []).map(s => s.tariff_id).filter(Boolean);

      if (productIds.length === 0 && tariffIds.length === 0) return [];

      // Get all active training_content rules for user's products
      let query = supabase
        .from("access_rules")
        .select("id, product_id, tariff_id, target_ref, target_label, is_active, conditions")
        .eq("grant_target_type", "training_content")
        .eq("is_active", true);

      if (productIds.length > 0) {
        query = query.in("product_id", productIds);
      }

      const { data, error } = await query;
      if (error) throw error;

      return {
        rules: (data || []).map(r => ({
          ...r,
          conditions: (r.conditions || { access_mode: "full", allowed_module_ids: [], allowed_lesson_ids: [] }) as TrainingContentConditions,
        })) as TrainingContentRule[],
        userTariffIds: tariffIds,
      };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Pure function: resolve the most specific training_content filter for a given training module.
 * Priority: tariff-level rule > product-level rule > no rule (full access).
 */
export function resolveTrainingContentFilter(
  rules: TrainingContentRule[],
  trainingModuleId: string,
  productId: string | null,
  userTariffIds: string[],
): TrainingContentFilter | null {
  if (!productId || rules.length === 0) return null;

  // Find rules targeting this training
  const matchingRules = rules.filter(r => r.target_ref === trainingModuleId && r.is_active);
  if (matchingRules.length === 0) return null;

  // Find most specific: tariff-level first
  let bestRule: TrainingContentRule | null = null;

  // Tariff-level rules (most specific)
  for (const rule of matchingRules) {
    if (rule.tariff_id && userTariffIds.includes(rule.tariff_id)) {
      bestRule = rule;
      break;
    }
  }

  // Fallback to product-level
  if (!bestRule) {
    bestRule = matchingRules.find(r => !r.tariff_id && r.product_id === productId) || null;
  }

  if (!bestRule) return null;

  const cond = bestRule.conditions;
  if (cond.access_mode === "full") {
    return { mode: "full", allowedModuleIds: new Set(), allowedLessonIds: new Set() };
  }

  return {
    mode: "partial",
    allowedModuleIds: new Set(cond.allowed_module_ids || []),
    allowedLessonIds: new Set(cond.allowed_lesson_ids || []),
  };
}

/**
 * Apply training_content filter to check if a specific module is visible.
 * A module is visible if: no filter, filter is full, or module is in allowedModuleIds.
 */
export function isModuleVisible(filter: TrainingContentFilter | null, moduleId: string): boolean {
  if (!filter || filter.mode === "full") return true;
  return filter.allowedModuleIds.has(moduleId);
}

/**
 * Apply training_content filter to check if a specific lesson is visible.
 * A lesson is visible if: no filter, filter is full, module is allowed, or lesson is explicitly allowed.
 */
export function isLessonVisible(filter: TrainingContentFilter | null, lessonId: string, moduleId: string): boolean {
  if (!filter || filter.mode === "full") return true;
  // If the module is fully allowed, all its lessons are visible
  if (filter.allowedModuleIds.has(moduleId)) return true;
  // Otherwise check explicit lesson allowlist
  return filter.allowedLessonIds.has(lessonId);
}
