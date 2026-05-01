import { useState, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useMonthGate, type MonthGateLessonInput } from "@/hooks/useMonthGate";

export interface LibraryLesson {
  id: string;
  module_id: string;
  title: string;
  slug: string;
  content_type: string;
  sort_order: number;
  is_active: boolean;
  is_completed: boolean;
  duration_minutes: number | null;
  published_at: string | null;
  isScheduled: boolean;
  content_month?: string | null;
  lock_reason?: "month_mismatch" | null;
  locked_month?: string | null;
}

/**
 * Batched lesson fetcher for the library table.
 * Fetches lessons for a set of module IDs in ONE query, caches results,
 * and never re-fetches a module that was already loaded.
 */
export function useLibraryLessons() {
  const { user } = useAuth();
  const [lessonsByModule, setLessonsByModule] = useState<Record<string, LibraryLesson[]>>({});
  const [loadingModules, setLoadingModules] = useState<Set<string>>(new Set());
  const [errorModules, setErrorModules] = useState<Set<string>>(new Set());
  const cacheRef = useRef<Record<string, LibraryLesson[]>>({});

  const fetchLessonsForModules = useCallback(
    async (moduleIds: string[]) => {
      // Filter out already cached and currently loading
      const toFetch = moduleIds.filter(
        (id) => !(id in cacheRef.current) && !loadingModules.has(id)
      );
      if (toFetch.length === 0) return;

      // Mark loading
      setLoadingModules((prev) => {
        const next = new Set(prev);
        toFetch.forEach((id) => next.add(id));
        return next;
      });

      try {
        // Batched query: all lessons for all requested modules
        const { data: lessonsData, error } = await supabase
          .from("training_lessons")
          .select("id, module_id, title, slug, content_type, sort_order, is_active, duration_minutes, published_at, content_month")
          .in("module_id", toFetch)
          .eq("is_active", true)
          .order("sort_order", { ascending: true });

        if (error) throw error;

        // Fetch user progress for these lessons
        let completedIds = new Set<string>();
        if (user && lessonsData && lessonsData.length > 0) {
          const lessonIds = lessonsData.map((l) => l.id);
          const { data: progressData } = await supabase
            .from("lesson_progress")
            .select("lesson_id")
            .eq("user_id", user.id)
            .in("lesson_id", lessonIds);
          completedIds = new Set((progressData || []).map((p) => p.lesson_id));
        }

        const now = new Date();
        // Group by module_id
        const grouped: Record<string, LibraryLesson[]> = {};
        // Initialize empty arrays for modules with no lessons
        for (const id of toFetch) {
          grouped[id] = [];
        }
        for (const l of lessonsData || []) {
          const publishedAt = l.published_at ? new Date(l.published_at) : null;
          const lesson: LibraryLesson = {
            id: l.id,
            module_id: l.module_id,
            title: l.title,
            slug: l.slug,
            content_type: l.content_type || "article",
            sort_order: l.sort_order,
            is_active: l.is_active,
            is_completed: completedIds.has(l.id),
            duration_minutes: l.duration_minutes,
            published_at: l.published_at,
            isScheduled: Boolean(publishedAt && publishedAt > now),
            content_month: (l as any).content_month ?? null,
          };
          if (!grouped[l.module_id]) grouped[l.module_id] = [];
          grouped[l.module_id].push(lesson);
        }

        // Update cache
        Object.assign(cacheRef.current, grouped);
        setLessonsByModule((prev) => ({ ...prev, ...grouped }));
        setErrorModules((prev) => {
          const next = new Set(prev);
          toFetch.forEach((id) => next.delete(id));
          return next;
        });
      } catch (err) {
        console.error("[useLibraryLessons] batch fetch error:", err);
        setErrorModules((prev) => {
          const next = new Set(prev);
          toFetch.forEach((id) => next.add(id));
          return next;
        });
      } finally {
        setLoadingModules((prev) => {
          const next = new Set(prev);
          toFetch.forEach((id) => next.delete(id));
          return next;
        });
      }
    },
    [user]
  );

  // Month-gate over all currently loaded lessons (non-admin only).
  const { isAdmin } = usePermissions();
  const isAdminUser = isAdmin();

  const allLoadedLessons = useMemo<LibraryLesson[]>(() => {
    const out: LibraryLesson[] = [];
    for (const arr of Object.values(lessonsByModule)) out.push(...arr);
    return out;
  }, [lessonsByModule]);

  const monthGateInputs: MonthGateLessonInput[] = useMemo(() => {
    if (isAdminUser) return [];
    return allLoadedLessons
      .filter((l) => !!l.content_month)
      .map((l) => ({ lesson_id: l.id, module_id: l.module_id, content_month: l.content_month ?? null }));
  }, [allLoadedLessons, isAdminUser]);

  const { map: monthGateMap } = useMonthGate(monthGateInputs);

  const getLessons = useCallback(
    (moduleId: string): LibraryLesson[] => {
      const base = lessonsByModule[moduleId] || cacheRef.current[moduleId] || [];
      if (monthGateMap.size === 0) return base;
      return base.map((l) => {
        const gate = monthGateMap.get(l.id);
        if (!gate) return l;
        return { ...l, lock_reason: gate.lock_reason, locked_month: gate.locked_month };
      });
    },
    [lessonsByModule, monthGateMap]
  );

  const isLoading = useCallback(
    (moduleId: string): boolean => loadingModules.has(moduleId),
    [loadingModules]
  );

  const hasError = useCallback(
    (moduleId: string): boolean => errorModules.has(moduleId),
    [errorModules]
  );

  return {
    fetchLessonsForModules,
    getLessons,
    isLoading,
    hasError,
  };
}
