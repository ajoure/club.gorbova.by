import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type BulkAction = "activate" | "deactivate";
export type SelectionMode = "exact" | "cascade";

export interface BulkPreviewResult {
  selectedModuleCount: number;
  selectedLessonCount: number;
  affectedModuleIds: string[];
  affectedModuleCount: number;
  affectedLessonIds: string[];
  affectedLessonCount: number;
  activeModules: number;
  inactiveModules: number;
  activeLessons: number;
  inactiveLessons: number;
  autoActivatedParentModuleIds: string[];
  autoActivatedParentModuleCount: number;
  action: BulkAction;
  selectionMode: SelectionMode;
}

/**
 * Recursively collects all descendant module IDs from the DB.
 * Uses iterative BFS to avoid stack overflow on deep trees.
 */
async function collectDescendantModuleIds(rootIds: string[]): Promise<string[]> {
  const allIds = new Set<string>(rootIds);
  let frontier = [...rootIds];

  while (frontier.length > 0) {
    const { data: children } = await supabase
      .from("training_modules")
      .select("id")
      .in("parent_module_id", frontier);

    if (!children || children.length === 0) break;

    frontier = [];
    for (const c of children) {
      if (!allIds.has(c.id)) {
        allIds.add(c.id);
        frontier.push(c.id);
      }
    }
  }

  return Array.from(allIds);
}

/**
 * Collect all ancestor module IDs for given module IDs (parent chain to root).
 */
async function collectAncestorModuleIds(moduleIds: string[]): Promise<string[]> {
  const ancestors = new Set<string>();
  let frontier = [...moduleIds];

  while (frontier.length > 0) {
    const { data: parents } = await supabase
      .from("training_modules")
      .select("id, parent_module_id")
      .in("id", frontier);

    if (!parents || parents.length === 0) break;

    frontier = [];
    for (const p of parents) {
      if (p.parent_module_id && !ancestors.has(p.parent_module_id) && !moduleIds.includes(p.parent_module_id)) {
        ancestors.add(p.parent_module_id);
        frontier.push(p.parent_module_id);
      }
    }
  }

  return Array.from(ancestors);
}

/**
 * Collect ancestor module IDs for lessons by their module_ids.
 */
async function collectLessonParentChains(lessonModuleIds: string[], alreadyActiveModuleIds: Set<string>): Promise<string[]> {
  // Get all ancestor modules for the lesson's direct parents
  const allAncestors = new Set<string>();
  
  // Add the direct parent module IDs
  for (const mid of lessonModuleIds) {
    allAncestors.add(mid);
  }
  
  // Walk up the tree
  let frontier = [...lessonModuleIds];
  while (frontier.length > 0) {
    const { data: parents } = await supabase
      .from("training_modules")
      .select("id, parent_module_id")
      .in("id", frontier);

    if (!parents || parents.length === 0) break;

    frontier = [];
    for (const p of parents) {
      if (p.parent_module_id && !allAncestors.has(p.parent_module_id)) {
        allAncestors.add(p.parent_module_id);
        frontier.push(p.parent_module_id);
      }
    }
  }

  // Filter to only those that are currently inactive and not already being activated
  const toCheck = Array.from(allAncestors);
  if (toCheck.length === 0) return [];

  const { data: mods } = await supabase
    .from("training_modules")
    .select("id, is_active")
    .in("id", toCheck);

  return (mods || [])
    .filter((m) => !m.is_active && !alreadyActiveModuleIds.has(m.id))
    .map((m) => m.id);
}

/**
 * Preview helper — reads DB to count affected modules/lessons without writing.
 */
export async function getBulkPreview(
  selectedModuleIds: string[],
  selectedLessonIds: string[],
  action: BulkAction,
  mode: SelectionMode,
): Promise<BulkPreviewResult> {
  if (selectedModuleIds.length === 0 && selectedLessonIds.length === 0) {
    return {
      selectedModuleCount: 0,
      selectedLessonCount: 0,
      affectedModuleIds: [],
      affectedModuleCount: 0,
      affectedLessonIds: [],
      affectedLessonCount: 0,
      activeModules: 0,
      inactiveModules: 0,
      activeLessons: 0,
      inactiveLessons: 0,
      autoActivatedParentModuleIds: [],
      autoActivatedParentModuleCount: 0,
      action,
      selectionMode: mode,
    };
  }

  // 1. Resolve affected module IDs
  let affectedModuleIds: string[];
  if (mode === "cascade" && selectedModuleIds.length > 0) {
    affectedModuleIds = await collectDescendantModuleIds(selectedModuleIds);
  } else {
    affectedModuleIds = [...selectedModuleIds];
  }

  // 2. Resolve affected lesson IDs
  let affectedLessonIds = [...selectedLessonIds];
  if (mode === "cascade" && affectedModuleIds.length > 0) {
    // Add all lessons within affected modules
    const { data: cascadeLessons } = await supabase
      .from("training_lessons")
      .select("id")
      .in("module_id", affectedModuleIds);
    const cascadeIds = new Set(affectedLessonIds);
    for (const l of cascadeLessons || []) cascadeIds.add(l.id);
    affectedLessonIds = Array.from(cascadeIds);
  }

  // 3. Auto-parent activation for activate action
  let autoActivatedParentModuleIds: string[] = [];
  if (action === "activate") {
    const alreadyAffected = new Set(affectedModuleIds);
    
    // For directly selected lessons, find their parent chains
    if (selectedLessonIds.length > 0) {
      const { data: lessonParents } = await supabase
        .from("training_lessons")
        .select("module_id")
        .in("id", selectedLessonIds);
      
      const lessonModuleIds = [...new Set((lessonParents || []).map((l) => l.module_id))];
      const parentChain = await collectLessonParentChains(lessonModuleIds, alreadyAffected);
      for (const pid of parentChain) {
        if (!alreadyAffected.has(pid)) {
          autoActivatedParentModuleIds.push(pid);
        }
      }
    }
    
    // For selected modules, also ensure their parents are active
    if (selectedModuleIds.length > 0) {
      const ancestors = await collectAncestorModuleIds(selectedModuleIds);
      const { data: ancestorData } = await supabase
        .from("training_modules")
        .select("id, is_active")
        .in("id", ancestors);
      
      for (const a of ancestorData || []) {
        if (!a.is_active && !alreadyAffected.has(a.id) && !autoActivatedParentModuleIds.includes(a.id)) {
          autoActivatedParentModuleIds.push(a.id);
        }
      }
    }
  }

  // 4. Count module states
  const allModuleIds = [...new Set([...affectedModuleIds, ...autoActivatedParentModuleIds])];
  let activeModules = 0, inactiveModules = 0;
  if (allModuleIds.length > 0) {
    const { data: modulesData } = await supabase
      .from("training_modules")
      .select("id, is_active")
      .in("id", allModuleIds);
    activeModules = modulesData?.filter((m) => m.is_active).length ?? 0;
    inactiveModules = modulesData?.filter((m) => !m.is_active).length ?? 0;
  }

  // 5. Count lesson states
  let activeLessons = 0, inactiveLessons = 0;
  if (affectedLessonIds.length > 0) {
    const { data: lessonsData } = await supabase
      .from("training_lessons")
      .select("id, is_active")
      .in("id", affectedLessonIds);
    activeLessons = lessonsData?.filter((l) => l.is_active).length ?? 0;
    inactiveLessons = lessonsData?.filter((l) => !l.is_active).length ?? 0;
  }

  return {
    selectedModuleCount: selectedModuleIds.length,
    selectedLessonCount: selectedLessonIds.length,
    affectedModuleIds,
    affectedModuleCount: allModuleIds.length,
    affectedLessonIds,
    affectedLessonCount: affectedLessonIds.length,
    activeModules,
    inactiveModules,
    activeLessons,
    inactiveLessons,
    autoActivatedParentModuleIds,
    autoActivatedParentModuleCount: autoActivatedParentModuleIds.length,
    action,
    selectionMode: mode,
  };
}

export function useBulkModuleActivation() {
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const execute = useCallback(
    async (
      selectedModuleIds: string[],
      selectedLessonIds: string[],
      action: BulkAction,
      mode: SelectionMode,
    ) => {
      if (selectedModuleIds.length === 0 && selectedLessonIds.length === 0) return false;

      setLoading(true);
      try {
        const isActive = action === "activate";
        const preview = await getBulkPreview(selectedModuleIds, selectedLessonIds, action, mode);

        // Update modules (affected + auto-activated parents)
        const allModuleIdsToUpdate = [
          ...new Set([...preview.affectedModuleIds, ...preview.autoActivatedParentModuleIds]),
        ];

        if (allModuleIdsToUpdate.length > 0) {
          const { error: modError } = await supabase
            .from("training_modules")
            .update({ is_active: isActive })
            .in("id", allModuleIdsToUpdate);
          if (modError) throw modError;
        }

        // Update lessons
        if (preview.affectedLessonIds.length > 0) {
          const { error: lessonError } = await supabase
            .from("training_lessons")
            .update({ is_active: isActive })
            .in("id", preview.affectedLessonIds);
          if (lessonError) throw lessonError;
        }

        // Audit log
        await supabase.from("audit_logs").insert({
          action: `bulk_module_${action}`,
          actor_type: "admin",
          actor_user_id: user?.id ?? null,
          actor_label: "bulk_module_activation",
          meta: {
            selected_module_ids: selectedModuleIds,
            selected_lesson_ids: selectedLessonIds,
            affected_module_ids: preview.affectedModuleIds,
            affected_lesson_ids: preview.affectedLessonIds,
            auto_activated_parent_module_ids: preview.autoActivatedParentModuleIds,
            selection_mode: mode,
            cascade_to_lessons: mode === "cascade",
            cascade_to_child_modules: mode === "cascade",
            action,
          },
        });

        // Invalidate queries
        queryClient.invalidateQueries({ queryKey: ["training_modules"] });
        queryClient.invalidateQueries({ queryKey: ["modules-tree-lessons"] });
        queryClient.invalidateQueries({ queryKey: ["container-lessons"] });

        const verb = isActive ? "активировано" : "деактивировано";
        toast.success(
          `${verb}: ${allModuleIdsToUpdate.length} модулей, ${preview.affectedLessonIds.length} уроков`,
        );

        return true;
      } catch (err: any) {
        console.error("Bulk module activation error:", err);
        toast.error(`Ошибка: ${err.message}`);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [user, queryClient],
  );

  return { execute, loading };
}
