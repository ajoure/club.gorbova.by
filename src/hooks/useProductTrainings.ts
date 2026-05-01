import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { TrainingContentRule } from "@/hooks/useTrainingContentRules";

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
  /**
   * true, если строка попала в дерево как страховочный потомок:
   * у неё product_id IS NULL, но она лежит под корнем,
   * привязанным к этому продукту через parent_module_id.
   * UI показывает таким строкам бейдж «Унаследовано».
   */
  product_id_inherited?: boolean;
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
  training_content_rule_ids: string[];
  legacy_module_access_count: number;
  has_active_entitlements: boolean;
}

export interface UnbindPreview {
  training_title: string;
  descendant_count: number;
  lesson_count: number;
  training_content_rules_count: number;
  legacy_module_access_count: number;
  has_active_entitlements: boolean;
  can_unbind: boolean;
}

const QUERY_KEY = "product-linked-trainings";

/* ── Recursive descendant helper ──────────────────────────── */

/**
 * Iteratively collects ALL descendant module IDs for a root training.
 * Walks the tree level by level until no more children are found.
 * Used by both preview and execute to guarantee consistent counts.
 */
async function getAllDescendantIds(rootId: string): Promise<string[]> {
  const allIds: string[] = [];
  const visited = new Set<string>([rootId]);
  let currentParentIds = [rootId];
  const MAX_ITERATIONS = 50;
  let iteration = 0;

  while (currentParentIds.length > 0) {
    if (++iteration > MAX_ITERATIONS) {
      console.error("[getAllDescendantIds] hard-stop: exceeded max iterations, possible cycle in tree data");
      break;
    }

    const { data: children, error } = await supabase
      .from("training_modules")
      .select("id")
      .in("parent_module_id", currentParentIds);
    if (error) throw error;
    if (!children || children.length === 0) break;

    const newChildIds = children.map(c => c.id).filter(id => !visited.has(id));
    if (newChildIds.length === 0) break;

    newChildIds.forEach(id => visited.add(id));
    allIds.push(...newChildIds);
    currentParentIds = newChildIds;
  }

  return allIds;
}

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

      const { data: modules, error } = await supabase
        .from("training_modules")
        .select("id, title, slug, public_id, is_active, is_container, parent_module_id, sort_order, product_id")
        .eq("product_id", productId)
        .order("sort_order");
      if (error) throw error;

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

      // Recursively collect all IDs from in-memory tree
      const collectAllTreeIds = (node: LinkedTraining): string[] => {
        const ids = [node.id];
        for (const child of node.children) {
          ids.push(...collectAllTreeIds(child));
        }
        return ids;
      };

      const diagnostics: Record<string, TrainingBindingDiagnostics> = {};
      rootModules.forEach(root => {
        const allIds = collectAllTreeIds(root);
        const legacyCount = allIds.reduce((sum, id) => sum + (legacyCounts[id] || 0), 0);
        const rulesCount = allIds.reduce((sum, id) => sum + (rulesCounts[id] || 0), 0);

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
      // Collect ALL descendants recursively
      const descendantIds = await getAllDescendantIds(trainingId);

      const { error: rootErr } = await supabase
        .from("training_modules")
        .update({ product_id: pid } as any)
        .eq("id", trainingId);
      if (rootErr) throw rootErr;

      if (descendantIds.length > 0) {
        const { error: childErr } = await supabase
          .from("training_modules")
          .update({ product_id: pid } as any)
          .in("id", descendantIds);
        if (childErr) throw childErr;
      }

      // Post-check: no descendants with NULL product_id
      if (descendantIds.length > 0) {
        const { data: badRows } = await supabase
          .from("training_modules")
          .select("id")
          .in("id", descendantIds)
          .is("product_id", null);
        if (badRows && badRows.length > 0) {
          console.error("[bind proof] descendants with NULL product_id after bind:", badRows.map(r => r.id));
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["module-legacy-access-count"] });
      queryClient.invalidateQueries({ queryKey: ["module-training-content-rules-count"] });
      queryClient.invalidateQueries({ queryKey: ["product-name-extended"] });
      toast.success("Тренинг привязан к продукту");
    },
    onError: () => toast.error("Ошибка привязки тренинга"),
  });

  // Unbind training from product
  const unbindTraining = useMutation({
    mutationFn: async (trainingId: string) => {
      // Guard: check for active training_content rules on THIS root training only
      const { data: activeRules } = await supabase
        .from("access_rules")
        .select("id")
        .eq("grant_target_type", "training_content")
        .eq("target_ref", trainingId)
        .eq("is_active", true);

      if (activeRules && activeRules.length > 0) {
        throw new Error("ACTIVE_RULES_EXIST");
      }

      // Get training info for audit
      const { data: training } = await supabase
        .from("training_modules")
        .select("id, title, product_id")
        .eq("id", trainingId)
        .single();

      // Collect ALL descendants recursively
      const descendantIds = await getAllDescendantIds(trainingId);

      // Update root
      const { error: rootErr } = await supabase
        .from("training_modules")
        .update({ product_id: null } as any)
        .eq("id", trainingId);
      if (rootErr) throw rootErr;

      // Update all descendants
      if (descendantIds.length > 0) {
        const { error: childErr } = await supabase
          .from("training_modules")
          .update({ product_id: null } as any)
          .in("id", descendantIds);
        if (childErr) throw childErr;
      }

      // Post-check: no descendants with non-null product_id
      const allCheckIds = [trainingId, ...descendantIds];
      const { data: badRows } = await supabase
        .from("training_modules")
        .select("id, product_id")
        .in("id", allCheckIds)
        .not("product_id", "is", null);
      if (badRows && badRows.length > 0) {
        console.error("[unbind proof] modules with non-null product_id after unbind:", badRows.map(r => r.id));
      }

      // Audit log
      await supabase.from("audit_logs").insert({
        action: "training.unbind.executed",
        actor_type: "admin",
        meta: {
          training_id: trainingId,
          training_title: training?.title,
          old_product_id: training?.product_id,
          affected_descendants_count: descendantIds.length,
          proof_orphan_count: badRows?.length || 0,
        },
      } as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["module-legacy-access-count"] });
      queryClient.invalidateQueries({ queryKey: ["module-training-content-rules-count"] });
      queryClient.invalidateQueries({ queryKey: ["product-name-extended"] });
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

    // Use shared recursive helper
    const descendantIds = await getAllDescendantIds(trainingId);
    const allIds = [trainingId, ...descendantIds];

    const { data: lessons } = await supabase
      .from("training_lessons")
      .select("id")
      .in("module_id", allIds);

    const { data: rules } = await supabase
      .from("access_rules")
      .select("id")
      .eq("grant_target_type", "training_content")
      .eq("target_ref", trainingId)
      .eq("is_active", true);

    const { data: legacyAccess } = await supabase
      .from("module_access")
      .select("id")
      .in("module_id", allIds);

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

    // Audit preview
    await supabase.from("audit_logs").insert({
      action: "training.rebind.preview",
      actor_type: "admin",
      meta: {
        training_id: trainingId,
        old_product_id: training?.product_id,
        new_product_id: newProductId,
        descendant_count: descendantIds.length,
        lesson_count: lessons?.length || 0,
        training_content_rules_count: rules?.length || 0,
      },
    } as any);

    return {
      current_product: currentProduct,
      new_product: np!,
      descendant_count: descendantIds.length,
      lesson_count: lessons?.length || 0,
      training_content_rules_count: rules?.length || 0,
      training_content_rule_ids: rules?.map(r => r.id) || [],
      legacy_module_access_count: legacyAccess?.length || 0,
      has_active_entitlements: hasEntitlements,
    };
  };

  // Get unbind preview
  const getUnbindPreview = async (trainingId: string): Promise<UnbindPreview> => {
    const { data: training } = await supabase
      .from("training_modules")
      .select("id, title, product_id")
      .eq("id", trainingId)
      .single();

    // Use shared recursive helper
    const descendantIds = await getAllDescendantIds(trainingId);
    const allIds = [trainingId, ...descendantIds];

    const { data: lessons } = await supabase
      .from("training_lessons")
      .select("id")
      .in("module_id", allIds);

    // Guard check: only training_content rules on THIS root training
    const { data: activeRules } = await supabase
      .from("access_rules")
      .select("id")
      .eq("grant_target_type", "training_content")
      .eq("target_ref", trainingId)
      .eq("is_active", true);

    const { data: legacyAccess } = await supabase
      .from("module_access")
      .select("id")
      .in("module_id", allIds);

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

    // Audit preview
    await supabase.from("audit_logs").insert({
      action: "training.unbind.preview",
      actor_type: "admin",
      meta: {
        training_id: trainingId,
        training_title: training?.title,
        product_id: training?.product_id,
        descendant_count: descendantIds.length,
        lesson_count: lessons?.length || 0,
        active_rules_count: activeRules?.length || 0,
      },
    } as any);

    return {
      training_title: training?.title || "",
      descendant_count: descendantIds.length,
      lesson_count: lessons?.length || 0,
      training_content_rules_count: activeRules?.length || 0,
      legacy_module_access_count: legacyAccess?.length || 0,
      has_active_entitlements: hasEntitlements,
      can_unbind: (activeRules?.length || 0) === 0,
    };
  };

  // Execute rebind
  const rebindTraining = useMutation({
    mutationFn: async ({ trainingId, newProductId }: { trainingId: string; newProductId: string }) => {
      const { data: training } = await supabase
        .from("training_modules")
        .select("id, product_id, title")
        .eq("id", trainingId)
        .single();

      const oldProductId = training?.product_id;

      // Collect ALL descendants recursively (same helper as preview)
      const descendantIds = await getAllDescendantIds(trainingId);
      const allIds = [trainingId, ...descendantIds];

      // Lessons count for audit
      const { data: lessons } = await supabase
        .from("training_lessons")
        .select("id")
        .in("module_id", allIds);

      // Deactivate training_content rules scoped to OLD product only
      let deactivatedRules: { id: string }[] = [];
      if (oldProductId) {
        const { data } = await supabase
          .from("access_rules")
          .update({ is_active: false } as any)
          .eq("grant_target_type", "training_content")
          .eq("target_ref", trainingId)
          .eq("is_active", true)
          .eq("product_id", oldProductId)
          .select("id");
        deactivatedRules = data || [];
      }

      // Update root
      const { error: rootErr } = await supabase
        .from("training_modules")
        .update({ product_id: newProductId } as any)
        .eq("id", trainingId);
      if (rootErr) throw rootErr;

      // Update all descendants
      if (descendantIds.length > 0) {
        const { error: childErr } = await supabase
          .from("training_modules")
          .update({ product_id: newProductId } as any)
          .in("id", descendantIds);
        if (childErr) throw childErr;
      }

      // Post-check: no modules in tree with old/NULL product_id
      const { data: badRows } = await supabase
        .from("training_modules")
        .select("id, product_id")
        .in("id", allIds)
        .neq("product_id", newProductId);
      if (badRows && badRows.length > 0) {
        console.error("[rebind proof] modules with wrong product_id after rebind:", badRows.map(r => ({ id: r.id, product_id: r.product_id })));
      }

      // Audit log
      await supabase.from("audit_logs").insert({
        action: "training.rebind.executed",
        actor_type: "admin",
        meta: {
          training_id: trainingId,
          training_title: training?.title,
          old_product_id: oldProductId,
          new_product_id: newProductId,
          affected_descendants_count: descendantIds.length,
          affected_lessons_count: lessons?.length || 0,
          deactivated_rule_ids: deactivatedRules.map(r => r.id),
          deactivated_rules_count: deactivatedRules.length,
          proof_orphan_count: badRows?.length || 0,
        },
      } as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["module-legacy-access-count"] });
      queryClient.invalidateQueries({ queryKey: ["module-training-content-rules-count"] });
      queryClient.invalidateQueries({ queryKey: ["product-name-extended"] });
      toast.success("Тренинг перепривязан к другому продукту");
    },
    onError: () => toast.error("Ошибка перепривязки тренинга"),
  });

  // Legacy cleanup: preview
  const getLegacyCleanupPreview = async (rootId: string) => {
    const descendantIds = await getAllDescendantIds(rootId);
    const allIds = [rootId, ...descendantIds];

    const { data: legacyRows, error } = await supabase
      .from("module_access")
      .select("id, module_id")
      .in("module_id", allIds);
    if (error) throw error;

    return {
      root_id: rootId,
      all_tree_ids: allIds,
      descendant_count: descendantIds.length,
      legacy_rows: legacyRows || [],
      total_count: legacyRows?.length || 0,
      sample_ids: (legacyRows || []).slice(0, 10).map(r => r.id),
    };
  };

  // Legacy cleanup: execute (uses confirmed set from preview)
  const cleanupLegacyAccess = useMutation({
    mutationFn: async ({ rootId, confirmedModuleIds }: { rootId: string; confirmedModuleIds: string[] }) => {
      // Delete only within confirmed tree
      const { data: deleted, error } = await supabase
        .from("module_access")
        .delete()
        .in("module_id", confirmedModuleIds)
        .select("id");
      if (error) throw error;

      // Post-check
      const { data: remaining } = await supabase
        .from("module_access")
        .select("id", { count: "exact", head: true })
        .in("module_id", confirmedModuleIds);

      const remainingCount = remaining ? 1 : 0; // head query — if data returned means still exists

      // Post-check with count
      const { count: postCheckCount } = await supabase
        .from("module_access")
        .select("id", { count: "exact", head: true })
        .in("module_id", confirmedModuleIds);

      // Audit
      await supabase.from("audit_logs").insert({
        action: "training.legacy_cleanup.executed",
        actor_type: "admin",
        actor_label: "legacy_cleanup",
        meta: {
          root_id: rootId,
          confirmed_module_ids_count: confirmedModuleIds.length,
          deleted_count: deleted?.length || 0,
          post_check_remaining: postCheckCount || 0,
          sample_deleted_ids: (deleted || []).slice(0, 10).map(r => r.id),
        },
      } as any);

      return {
        deleted_count: deleted?.length || 0,
        post_check_remaining: postCheckCount || 0,
        root_id: rootId,
        descendants_count: confirmedModuleIds.length - 1,
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["module-legacy-access-count"] });
      if (result.post_check_remaining === 0) {
        toast.success(`Старые настройки очищены: удалено ${result.deleted_count} записей`);
      } else {
        toast.warning(`Удалено ${result.deleted_count} записей, но осталось ${result.post_check_remaining}. Обратитесь к разработчику.`);
      }
    },
    onError: () => toast.error("Ошибка очистки старых настроек"),
  });

  return {
    trainings: data?.trainings || [],
    diagnostics: data?.diagnostics || {},
    isLoading,
    bindTraining: bindTraining.mutateAsync,
    unbindTraining: unbindTraining.mutateAsync,
    rebindTraining: rebindTraining.mutateAsync,
    getRebindPreview,
    getUnbindPreview,
    getLegacyCleanupPreview,
    cleanupLegacyAccess: cleanupLegacyAccess.mutateAsync,
    isCleaningLegacy: cleanupLegacyAccess.isPending,
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
        .select("id, title, slug, public_id, is_active, product_id, parent_module_id, sort_order, owner_product:products_v2(name)")
        .is("parent_module_id", null)
        .order("is_active", { ascending: false })
        .order("sort_order");
      if (error) throw error;

      const normalize = (m: any) => ({
        ...m,
        owner_product_name: (m.owner_product as any)?.name || null,
        owner_product: undefined,
      });

      const all = (data || []).map(normalize);
      const free = all.filter(m => !m.product_id);
      const currentProduct = all.filter(m => m.product_id === currentProductId);
      const otherProduct = all.filter(m => m.product_id && m.product_id !== currentProductId);

      return { free, currentProduct, otherProduct, all };
    },
    enabled: !!currentProductId,
  });
}

// ── PATCH A: Visible trainings (owned + rule-linked) ────────────────

export interface VisibleTraining {
  id: string;
  title: string;
  public_id: string | null;
  is_active: boolean;
  is_owned: boolean;
  is_rule_linked: boolean;
  owner_product_id: string | null;
  owner_product_name: string | null;
  rule_ids: string[];
  rule_count: number;
  /** Full owned tree — only present when is_owned */
  owned_tree?: LinkedTraining;
}

/**
 * Fetches root training modules referenced by training_content rules of this product,
 * but NOT owned by this product (i.e. external trainings used via rules).
 */
export function useRuleLinkedTrainings(productId?: string, contentRules?: TrainingContentRule[]) {
  return useQuery({
    queryKey: ["rule-linked-trainings", productId, contentRules?.map(r => r.id).join(",")],
    queryFn: async () => {
      if (!productId || !contentRules?.length) return [];

      // Only active rules
      const activeRules = contentRules.filter(r => r.is_active);
      if (activeRules.length === 0) return [];

      // Unique target_refs from active training_content rules
      const targetRefMap = new Map<string, string[]>();
      for (const r of activeRules) {
        if (!r.target_ref) continue;
        const existing = targetRefMap.get(r.target_ref) || [];
        existing.push(r.id);
        targetRefMap.set(r.target_ref, existing);
      }

      const targetRefs = Array.from(targetRefMap.keys());
      if (targetRefs.length === 0) return [];

      // Fetch only root modules (parent_module_id IS NULL) that are NOT owned by this product
      const { data: modules, error } = await supabase
        .from("training_modules")
        .select("id, title, public_id, is_active, product_id")
        .in("id", targetRefs)
        .is("parent_module_id", null)
        .neq("product_id", productId);

      if (error) throw error;
      if (!modules?.length) return [];

      // Also include modules with null product_id (orphans referenced by rules)
      const { data: orphanModules } = await supabase
        .from("training_modules")
        .select("id, title, public_id, is_active, product_id")
        .in("id", targetRefs)
        .is("parent_module_id", null)
        .is("product_id", null);

      const allModules = [...(modules || []), ...(orphanModules || [])];
      // Deduplicate by id
      const uniqueModules = Array.from(new Map(allModules.map(m => [m.id, m])).values());

      // Get owner product names
      const ownerProductIds = [...new Set(uniqueModules.map(m => m.product_id).filter(Boolean))] as string[];
      let ownerNames: Record<string, string> = {};
      if (ownerProductIds.length > 0) {
        const { data: products } = await supabase
          .from("products_v2")
          .select("id, name")
          .in("id", ownerProductIds);
        products?.forEach(p => { ownerNames[p.id] = p.name; });
      }

      return uniqueModules.map(m => ({
        id: m.id,
        title: m.title,
        public_id: m.public_id,
        is_active: m.is_active,
        owner_product_id: m.product_id,
        owner_product_name: m.product_id ? (ownerNames[m.product_id] || null) : null,
        rule_ids: targetRefMap.get(m.id) || [],
        rule_count: (targetRefMap.get(m.id) || []).length,
      }));
    },
    enabled: !!productId && !!contentRules?.length,
    staleTime: 30_000,
  });
}

/**
 * Merges owned trainings and rule-linked trainings into a single VisibleTraining[] collection.
 * Deduplicates by training_id. Returns map and count.
 */
export function useVisibleTrainings(
  ownedTrainings: LinkedTraining[],
  ruleLinkedData: ReturnType<typeof useRuleLinkedTrainings>["data"],
  productId?: string,
) {
  return useMemo(() => {
    const map = new Map<string, VisibleTraining>();

    // Add owned trainings
    for (const t of ownedTrainings) {
      map.set(t.id, {
        id: t.id,
        title: t.title,
        public_id: t.public_id,
        is_active: t.is_active,
        is_owned: true,
        is_rule_linked: false,
        owner_product_id: productId || null,
        owner_product_name: null, // self-owned, no need
        rule_ids: [],
        rule_count: 0,
        owned_tree: t,
      });
    }

    // Merge rule-linked trainings
    for (const rl of (ruleLinkedData || [])) {
      const existing = map.get(rl.id);
      if (existing) {
        // Training is both owned and rule-linked
        existing.is_rule_linked = true;
        existing.rule_ids = rl.rule_ids;
        existing.rule_count = rl.rule_count;
      } else {
        map.set(rl.id, {
          id: rl.id,
          title: rl.title,
          public_id: rl.public_id,
          is_active: rl.is_active,
          is_owned: false,
          is_rule_linked: true,
          owner_product_id: rl.owner_product_id,
          owner_product_name: rl.owner_product_name,
          rule_ids: rl.rule_ids,
          rule_count: rl.rule_count,
        });
      }
    }

    const visibleTrainings = Array.from(map.values());
    const visibleTrainingsMap: Record<string, VisibleTraining> = {};
    for (const vt of visibleTrainings) {
      visibleTrainingsMap[vt.id] = vt;
    }

    return {
      visibleTrainings,
      visibleTrainingsMap,
      visibleTrainingCount: visibleTrainings.length,
    };
  }, [ownedTrainings, ruleLinkedData, productId]);
}