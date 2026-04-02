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
 * 
 * Phase C enhancement: Also reads entitlement.meta for bonus scope resolution.
 * Generates synthetic TrainingContentRule entries for entitlements with
 * scope_resolution_mode != full_tariff_scope, enforcing Variant B.
 */
export function useActiveTrainingContentRules() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["active-training-content-rules", user?.id],
    queryFn: async () => {
      if (!user) return [];

      // Get user's active entitlements WITH meta for bonus scope resolution
      const { data: ents } = await supabase
        .from("entitlements")
        .select("product_id, meta")
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

      const dbRules = (data || []).map(r => ({
        ...r,
        conditions: (r.conditions as unknown as TrainingContentConditions) || { access_mode: "full", allowed_module_ids: [], allowed_lesson_ids: [] },
      })) as TrainingContentRule[];

      // Phase C: Generate synthetic rules from entitlement.meta (bonus scope resolver)
      const syntheticRules = await resolveBonusScopeRules(ents || [], supabase);

      return {
        rules: [...dbRules, ...syntheticRules],
        userTariffIds: tariffIds,
      };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Phase C: Bonus scope resolver.
 * Reads entitlement.meta.scope_resolution_mode and generates synthetic
 * TrainingContentRule entries to restrict access for bonus entitlements.
 * 
 * Variant B enforcement:
 * - full_tariff_scope → no synthetic rule needed (full access via DB rules)
 * - module_scope_only → partial rule with allowed_module_ids from historical_module_product_ids mapping
 * - union_scope → partial rule combining tariff modules + standalone modules
 * - no_scope → partial rule with empty allowed lists (blocks everything)
 * - manual_review → treated as no_scope (safe default)
 */
async function resolveBonusScopeRules(
  entitlements: Array<{ product_id: string | null; meta: any }>,
  supabaseClient: typeof supabase,
): Promise<TrainingContentRule[]> {
  const syntheticRules: TrainingContentRule[] = [];

  // Separate entitlements into two groups:
  // 1. Entitlements WITH scope_resolution_mode (explicit scope from write-side)
  // 2. Entitlements WITHOUT meta (legacy — need safe default)
  const scopedEnts = entitlements.filter(e => {
    const meta = (e.meta || {}) as Record<string, any>;
    const mode = meta.scope_resolution_mode;
    return mode && mode !== 'full_tariff_scope';
  });

  // Legacy entitlements without scope_resolution_mode that are product-linked
  // These need a safe default to prevent silent full access
  const legacyEnts = entitlements.filter(e => {
    const meta = (e.meta || {}) as Record<string, any>;
    return !meta.scope_resolution_mode && e.product_id;
  });

  const allRelevantEnts = [...scopedEnts, ...legacyEnts];
  if (allRelevantEnts.length === 0) return syntheticRules;

  // Collect all historical_module_product_ids for batch mapping (from scoped ents only)
  const allModuleProductIds = new Set<string>();
  scopedEnts.forEach(e => {
    const meta = (e.meta || {}) as Record<string, any>;
    const ids = meta.historical_module_product_ids;
    if (Array.isArray(ids)) {
      ids.forEach((id: string) => allModuleProductIds.add(id));
    }
  });

  // Batch query: map module product_ids → training_module_ids
  let moduleProductToTrainingIds = new Map<string, string[]>();
  if (allModuleProductIds.size > 0) {
    const { data: mappedModules } = await supabaseClient
      .from("training_modules")
      .select("id, product_id")
      .in("product_id", [...allModuleProductIds])
      .eq("is_active", true);

    (mappedModules || []).forEach(m => {
      if (!m.product_id) return;
      const existing = moduleProductToTrainingIds.get(m.product_id) || [];
      existing.push(m.id);
      moduleProductToTrainingIds.set(m.product_id, existing);
    });
  }

  // Find root training modules for all relevant product_ids
  const entProductIds = [...new Set(allRelevantEnts.map(e => e.product_id).filter(Boolean))] as string[];
  let productToRootTraining = new Map<string, string>();
  if (entProductIds.length > 0) {
    const { data: rootModules } = await supabaseClient
      .from("training_modules")
      .select("id, product_id")
      .in("product_id", entProductIds)
      .is("parent_module_id", null)
      .eq("is_active", true);

    (rootModules || []).forEach(m => {
      if (m.product_id) {
        productToRootTraining.set(m.product_id, m.id);
      }
    });
  }

  // Process SCOPED entitlements (have explicit scope_resolution_mode)
  for (const ent of scopedEnts) {
    const meta = (ent.meta || {}) as Record<string, any>;
    const mode = meta.scope_resolution_mode as string;
    const productId = ent.product_id;
    if (!productId) continue;

    const rootTrainingId = productToRootTraining.get(productId);
    if (!rootTrainingId) continue;

    const historicalModuleProductIds: string[] = meta.historical_module_product_ids || [];
    const allowedModuleIds: string[] = [];

    for (const modProdId of historicalModuleProductIds) {
      const trainingIds = moduleProductToTrainingIds.get(modProdId);
      if (trainingIds) {
        allowedModuleIds.push(...trainingIds);
      }
    }

    let accessMode: "full" | "partial" = "partial";
    let finalAllowedModuleIds = allowedModuleIds;

    if (mode === 'no_scope' || mode === 'manual_review') {
      finalAllowedModuleIds = [];
    } else if (mode === 'module_scope_only') {
      finalAllowedModuleIds = allowedModuleIds;
    } else if (mode === 'union_scope') {
      accessMode = "full";
    }

    syntheticRules.push({
      id: `synthetic-bonus-${productId}`,
      product_id: productId,
      tariff_id: null,
      target_ref: rootTrainingId,
      target_label: `Bonus scope: ${mode}`,
      is_active: true,
      conditions: {
        access_mode: accessMode,
        allowed_module_ids: finalAllowedModuleIds,
        allowed_lesson_ids: [],
        rule_purpose: `synthetic_bonus_${mode}`,
      },
      notes: null,
    });
  }

  // Process LEGACY entitlements (no meta → safe default)
  // CRITICAL: Bonus entitlements without historical/tariff context → no_scope
  // Direct purchases with valid tariff context → DB tariff rules take priority in resolver
  // The synthetic no_scope rule has lowest priority and only activates when no DB rule matches
  for (const ent of legacyEnts) {
    const productId = ent.product_id;
    if (!productId) continue;

    const rootTrainingId = productToRootTraining.get(productId);
    if (!rootTrainingId) continue;

    // Check if we already generated a rule for this product (from scopedEnts)
    if (syntheticRules.some(r => r.id === `synthetic-bonus-${productId}` || r.id === `synthetic-legacy-safe-${productId}`)) {
      continue;
    }

    // Generate safe-default no_scope rule
    // This will be overridden by any matching DB tariff rule (Priority 1/2 in resolver)
    // Only activates when user has entitlement but NO matching tariff subscription
    syntheticRules.push({
      id: `synthetic-legacy-safe-${productId}`,
      product_id: productId,
      tariff_id: null,
      target_ref: rootTrainingId,
      target_label: `Legacy safe default (no meta)`,
      is_active: true,
      conditions: {
        access_mode: "partial",
        allowed_module_ids: [],
        allowed_lesson_ids: [],
        rule_purpose: 'synthetic_legacy_no_meta_safe_default',
      },
      notes: null,
    });
  }

  return syntheticRules;
}

/**
 * Pure function: resolve the most specific training_content filter for a given training module.
 * Priority: 
 *   1. tariff-level DB rule (most specific)
 *   2. product-level DB rule
 *   3. synthetic bonus rule from entitlement.meta (Variant B enforcement)
 *   4. no rule → null (full access)
 * 
 * For product-linked cb20 modules, synthetic bonus rules ensure that
 * standalone_only users see only their purchased modules, not full access.
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

  // Separate DB rules from synthetic rules
  const dbRules = matchingRules.filter(r => !r.id.startsWith('synthetic-'));
  const syntheticBonusRules = matchingRules.filter(r => r.id.startsWith('synthetic-bonus-'));
  const syntheticLegacyRules = matchingRules.filter(r => r.id.startsWith('synthetic-legacy-safe-'));

  let bestRule: TrainingContentRule | null = null;

  // Priority 1: Tariff-level DB rules (most specific — direct purchase with active subscription)
  for (const rule of dbRules) {
    if (rule.tariff_id && userTariffIds.includes(rule.tariff_id)) {
      bestRule = rule;
      break;
    }
  }

  // Priority 2: Product-level DB rules (no tariff specified)
  if (!bestRule) {
    bestRule = dbRules.find(r => !r.tariff_id && r.product_id === productId) || null;
  }

  // Priority 3: Synthetic bonus rules (explicit scope_resolution_mode from meta)
  if (!bestRule && syntheticBonusRules.length > 0) {
    bestRule = syntheticBonusRules[0];
  }

  // Priority 4: Synthetic legacy safe default (no meta → no_scope)
  // This catches bonus entitlements without tariff context that would otherwise get full access
  if (!bestRule && syntheticLegacyRules.length > 0) {
    bestRule = syntheticLegacyRules[0];
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
