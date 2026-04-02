import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type BulkAction = "activate" | "deactivate";

export interface BulkPreviewResult {
  selectedModuleCount: number;
  affectedModuleIds: string[];
  affectedModuleCount: number;
  affectedLessonCount: number;
  activeModules: number;
  inactiveModules: number;
  activeLessons: number;
  inactiveLessons: number;
  action: BulkAction;
  cascadeToLessons: boolean;
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
 * Preview helper — reads DB to count affected modules/lessons without writing.
 */
export async function getBulkModuleActivationPreview(
  moduleIds: string[],
  action: BulkAction,
  cascadeToLessons: boolean,
): Promise<BulkPreviewResult> {
  if (moduleIds.length === 0) {
    return {
      selectedModuleCount: 0,
      affectedModuleIds: [],
      affectedModuleCount: 0,
      affectedLessonCount: 0,
      activeModules: 0,
      inactiveModules: 0,
      activeLessons: 0,
      inactiveLessons: 0,
      action,
      cascadeToLessons,
    };
  }

  // Always cascade to child modules
  const affectedModuleIds = await collectDescendantModuleIds(moduleIds);

  // Count module states
  const { data: modulesData } = await supabase
    .from("training_modules")
    .select("id, is_active")
    .in("id", affectedModuleIds);

  const activeModules = modulesData?.filter((m) => m.is_active).length ?? 0;
  const inactiveModules = modulesData?.filter((m) => !m.is_active).length ?? 0;

  let activeLessons = 0;
  let inactiveLessons = 0;
  let affectedLessonCount = 0;

  if (cascadeToLessons) {
    const { data: lessonsData } = await supabase
      .from("training_lessons")
      .select("id, is_active")
      .in("module_id", affectedModuleIds);

    activeLessons = lessonsData?.filter((l) => l.is_active).length ?? 0;
    inactiveLessons = lessonsData?.filter((l) => !l.is_active).length ?? 0;
    affectedLessonCount = lessonsData?.length ?? 0;
  }

  return {
    selectedModuleCount: moduleIds.length,
    affectedModuleIds,
    affectedModuleCount: affectedModuleIds.length,
    affectedLessonCount,
    activeModules,
    inactiveModules,
    activeLessons,
    inactiveLessons,
    action,
    cascadeToLessons,
  };
}

export function useBulkModuleActivation() {
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const execute = useCallback(
    async (
      selectedModuleIds: string[],
      action: BulkAction,
      cascadeToLessons: boolean,
    ) => {
      if (selectedModuleIds.length === 0) return false;

      setLoading(true);
      try {
        const isActive = action === "activate";

        // Resolve all descendant modules
        const affectedModuleIds = await collectDescendantModuleIds(selectedModuleIds);

        // Update modules
        const { error: modError } = await supabase
          .from("training_modules")
          .update({ is_active: isActive })
          .in("id", affectedModuleIds);

        if (modError) throw modError;

        let affectedLessonCount = 0;

        if (cascadeToLessons) {
          // Count lessons first
          const { count } = await supabase
            .from("training_lessons")
            .select("id", { count: "exact", head: true })
            .in("module_id", affectedModuleIds);

          affectedLessonCount = count ?? 0;

          // Update lessons
          const { error: lessonError } = await supabase
            .from("training_lessons")
            .update({ is_active: isActive })
            .in("module_id", affectedModuleIds);

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
            affected_module_ids: affectedModuleIds,
            affected_lesson_ids_count: affectedLessonCount,
            cascade_to_lessons: cascadeToLessons,
            cascade_to_child_modules: true,
            action,
          },
        });

        // Invalidate queries
        queryClient.invalidateQueries({ queryKey: ["training_modules"] });
        queryClient.invalidateQueries({ queryKey: ["modules-tree-lessons"] });
        queryClient.invalidateQueries({ queryKey: ["container-lessons"] });

        const verb = isActive ? "активировано" : "деактивировано";
        toast.success(
          `${verb}: ${affectedModuleIds.length} модулей${cascadeToLessons ? `, ${affectedLessonCount} уроков` : ""}`,
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
