import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { toast } from "sonner";
import { extractPathsFromBlocks, extractPathsFromProgress } from "@/components/admin/lesson-editor/blocks/extractTrainingAssetPaths";
import { deleteTrainingAssets, type DeleteTrainingAssetsResult } from "@/components/admin/lesson-editor/blocks/uploadToTrainingAssets";
import { useMonthGate, type MonthGateLessonInput } from "@/hooks/useMonthGate";

export interface LessonAttachment {
  id: string;
  lesson_id: string;
  file_name: string;
  file_url: string;
  file_type: string | null;
  file_size: number | null;
  sort_order: number;
  created_at: string;
}

export type CompletionMode = 'manual' | 'view_all_blocks' | 'watch_video' | 'kvest';

export interface TrainingLesson {
  id: string;
  module_id: string;
  title: string;
  slug: string;
  description: string | null;
  content: string | null;
  content_type: "video" | "audio" | "article" | "document" | "mixed";
  video_url: string | null;
  audio_url: string | null;
  thumbnail_url: string | null;
  sort_order: number;
  duration_minutes: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Kvest fields
  published_at: string | null;
  require_previous: boolean;
  completion_mode: CompletionMode;
  content_month?: string | null;
  // Computed fields
  is_completed?: boolean;
  attachments?: LessonAttachment[];
  // PATCH: Scheduled lessons flag
  isScheduled?: boolean;
  // Month-gate (cabinet, source: backend RPC)
  lock_reason?: "month_mismatch" | null;
  locked_month?: string | null;
}

export interface TrainingLessonFormData {
  module_id: string;
  title: string;
  slug: string;
  description?: string;
  content?: string;
  content_type?: "video" | "audio" | "article" | "document" | "mixed";
  video_url?: string;
  audio_url?: string;
  thumbnail_url?: string;
  sort_order?: number;
  duration_minutes?: number;
  is_active?: boolean;
  content_month?: string | null;
  // Scheduling & completion fields
  published_at?: string;
  completion_mode?: CompletionMode;
  require_previous?: boolean;
}

export function useTrainingLessons(moduleId?: string) {
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const isAdminUser = isAdmin();
  const [lessons, setLessons] = useState<TrainingLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedOnceRef = useRef(false);

  const fetchLessons = useCallback(async () => {
    if (!moduleId) {
      setLessons([]);
      setLoading(false);
      return;
    }

    try {
      // Only show loading on initial fetch — background refetch must NOT collapse DOM
      if (!hasLoadedOnceRef.current) {
        setLoading(true);
      }
      
      // PATCH-1: Fetch ALL lessons (admin sees inactive too)
      // Filtering by is_active and published_at happens after enrichment
      const { data: lessonsData, error } = await supabase
        .from("training_lessons")
        .select("*")
        .eq("module_id", moduleId)
        .order("sort_order", { ascending: true });

      if (error) throw error;

      // Fetch attachments for all lessons
      const lessonIds = lessonsData?.map(l => l.id) || [];
      const { data: attachmentsData } = await supabase
        .from("lesson_attachments")
        .select("*")
        .in("lesson_id", lessonIds)
        .order("sort_order", { ascending: true });

      // Fetch user progress
      let completedLessonIds: string[] = [];
      if (user) {
        const { data: progressData } = await supabase
          .from("lesson_progress")
          .select("lesson_id")
          .eq("user_id", user.id)
          .in("lesson_id", lessonIds);

        completedLessonIds = progressData?.map(p => p.lesson_id) || [];
      }

      // Combine data
      const enrichedLessons = lessonsData?.map(lesson => ({
        ...lesson,
        content_type: lesson.content_type as TrainingLesson["content_type"],
        completion_mode: (lesson.completion_mode || 'manual') as CompletionMode,
        require_previous: lesson.require_previous ?? false,
        is_completed: completedLessonIds.includes(lesson.id),
        attachments: attachmentsData?.filter(a => a.lesson_id === lesson.id) || [],
      })) || [];

      // PATCH-1: Filter and flag lessons based on admin status
      const now = new Date();
      const lessonsWithScheduleFlag = enrichedLessons
        // Filter: admin sees all, user sees only is_active=true
        .filter(lesson => isAdminUser || lesson.is_active)
        // НЕ фильтруем по published_at — урок показываем, но с флагом isScheduled
        .map(lesson => {
          const publishedAt = lesson.published_at ? new Date(lesson.published_at) : null;
          const isScheduled = publishedAt && publishedAt > now;
          return {
            ...lesson,
            // isScheduled = true для уроков с будущей датой (показываем "Скоро")
            isScheduled: Boolean(isScheduled),
          };
        });

      setLessons(lessonsWithScheduleFlag);
    } catch (error) {
      console.error("Error fetching lessons:", error);
      toast.error("Ошибка загрузки уроков");
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId, user?.id, isAdminUser]);

  useEffect(() => {
    fetchLessons();
  }, [fetchLessons]);

  // Month-gate (backend SOT): only for non-admin users.
  const monthGateInputs: MonthGateLessonInput[] = useMemo(() => {
    if (isAdminUser) return [];
    return lessons
      .filter((l) => !!l.content_month)
      .map((l) => ({
        lesson_id: l.id,
        module_id: l.module_id,
        content_month: l.content_month ?? null,
      }));
  }, [lessons, isAdminUser]);

  const { map: monthGateMap } = useMonthGate(monthGateInputs);

  const lessonsWithGate = useMemo<TrainingLesson[]>(() => {
    if (monthGateMap.size === 0) return lessons;
    return lessons.map((l) => {
      const gate = monthGateMap.get(l.id);
      if (!gate) return l;
      return { ...l, lock_reason: gate.lock_reason, locked_month: gate.locked_month };
    });
  }, [lessons, monthGateMap]);

  const createLesson = async (data: TrainingLessonFormData): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from("training_lessons")
        .insert(data);

      if (error) throw error;

      toast.success("Урок создан");
      await fetchLessons();
      return true;
    } catch (error) {
      console.error("Error creating lesson:", error);
      toast.error("Ошибка создания урока");
      return false;
    }
  };

  const updateLesson = async (id: string, data: Partial<TrainingLessonFormData>): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from("training_lessons")
        .update(data)
        .eq("id", id);

      if (error) throw error;

      toast.success("Урок обновлён");
      await fetchLessons();
      return true;
    } catch (error) {
      console.error("Error updating lesson:", error);
      toast.error("Ошибка обновления урока");
      return false;
    }
  };

  const deleteLesson = async (id: string): Promise<boolean> => {
    try {
      // P2: Собираем все storage paths перед удалением урока
      const allPaths: string[] = [];

      // A) Пути из lesson_blocks.content
      const { data: blocks, error: blocksError } = await supabase
        .from("lesson_blocks")
        .select("content")
        .eq("lesson_id", id);

      if (blocksError) {
        console.error("[deleteLesson] SELECT lesson_blocks error, STOP:", blocksError);
        toast.error("Ошибка чтения блоков урока, удаление отменено");
        return false;
      }

      if (blocks && blocks.length > 0) {
        allPaths.push(...extractPathsFromBlocks(blocks));
      }

      // B) Пути из user_lesson_progress.response (student uploads)
      const { data: progressRecords, error: progressError } = await supabase
        .from("user_lesson_progress")
        .select("response")
        .eq("lesson_id", id);

      if (progressError) {
        console.error("[deleteLesson] SELECT user_lesson_progress error, STOP:", progressError);
        toast.error("Ошибка чтения прогресса учеников, удаление отменено");
        return false;
      }

      if (progressRecords && progressRecords.length > 0) {
        allPaths.push(...extractPathsFromProgress(progressRecords));
      }

      // Дедуп
      const uniquePaths = [...new Set(allPaths)];

      // Удаляем файлы из Storage (если есть) — с STOP-guard
      if (uniquePaths.length > 0) {
        console.warn(`[deleteLesson] Cleaning up ${uniquePaths.length} storage paths for lesson ${id}`);
        const result = await deleteTrainingAssets(uniquePaths, { type: "lesson", id }, "lesson_deleted");
        if (!result.ok) {
          console.error("[deleteLesson] Storage cleanup failed, STOP:", result.error, "blocked_paths:", result.blocked_paths);
          toast.error(`Не удалось очистить файлы урока (${result.error}), удаление отменено`);
          return false;
        }
        // Информативные toast о shared/partial (не блокируют удаление)
        if ((result.skipped_shared_count ?? 0) > 0) {
          toast.info(`Файлы используются в других уроках — удаление файлов пропущено: ${result.skipped_shared_count}`);
        } else if ((result.attempted_delete_count ?? 0) > 0 && (result.deleted_count ?? 0) < (result.attempted_delete_count ?? 0)) {
          toast.info("Часть файлов уже отсутствовала в хранилище");
        }
      }

      // Теперь удаляем запись урока — ТОЛЬКО после успешного cleanup
      const { error } = await supabase
        .from("training_lessons")
        .delete()
        .eq("id", id);

      if (error) throw error;

      toast.success("Урок удалён");
      await fetchLessons();
      return true;
    } catch (error) {
      console.error("Error deleting lesson:", error);
      toast.error("Ошибка удаления урока");
      return false;
    }
  };

  const markCompleted = async (lessonId: string): Promise<boolean> => {
    if (!user) {
      toast.error("Необходима авторизация");
      return false;
    }

    try {
      const { error } = await supabase
        .from("lesson_progress")
        .insert({
          user_id: user.id,
          lesson_id: lessonId,
        });

      if (error && error.code !== "23505") { // Ignore duplicate key error
        throw error;
      }

      toast.success("Урок отмечен как пройденный");
      await fetchLessons();
      return true;
    } catch (error) {
      console.error("Error marking lesson completed:", error);
      toast.error("Ошибка сохранения прогресса");
      return false;
    }
  };

  const markIncomplete = async (lessonId: string): Promise<boolean> => {
    if (!user) return false;

    try {
      const { error } = await supabase
        .from("lesson_progress")
        .delete()
        .eq("user_id", user.id)
        .eq("lesson_id", lessonId);

      if (error) throw error;

      await fetchLessons();
      return true;
    } catch (error) {
      console.error("Error unmarking lesson:", error);
      return false;
    }
  };

  const addAttachment = async (lessonId: string, attachment: Omit<LessonAttachment, "id" | "lesson_id" | "created_at">): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from("lesson_attachments")
        .insert({
          lesson_id: lessonId,
          ...attachment,
        });

      if (error) throw error;

      toast.success("Файл добавлен");
      await fetchLessons();
      return true;
    } catch (error) {
      console.error("Error adding attachment:", error);
      toast.error("Ошибка добавления файла");
      return false;
    }
  };

  const removeAttachment = async (attachmentId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from("lesson_attachments")
        .delete()
        .eq("id", attachmentId);

      if (error) throw error;

      toast.success("Файл удалён");
      await fetchLessons();
      return true;
    } catch (error) {
      console.error("Error removing attachment:", error);
      toast.error("Ошибка удаления файла");
      return false;
    }
  };

  const reorderLessons = async (orderedIds: string[]): Promise<boolean> => {
    if (!moduleId) return false;

    // Optimistic update
    setLessons(prev => {
      const map = new Map(prev.map(l => [l.id, l]));
      return orderedIds
        .map((id, i) => {
          const item = map.get(id);
          return item ? { ...item, sort_order: i * 10 } : null;
        })
        .filter(Boolean) as TrainingLesson[];
    });

    try {
      const updates = orderedIds.map((id, index) =>
        supabase.from("training_lessons")
          .update({ sort_order: index * 10 })
          .eq("id", id)
          .eq("module_id", moduleId)
      );
      const results = await Promise.all(updates);
      const failed = results.filter(r => r.error);
      if (failed.length > 0) {
        console.error("[reorderLessons] Partial failure:", failed.map(r => r.error));
        toast.error("Ошибка сохранения порядка уроков");
        await fetchLessons();
        return false;
      }
      return true;
    } catch (error) {
      console.error("[reorderLessons] Error:", error);
      toast.error("Ошибка сохранения порядка");
      await fetchLessons();
      return false;
    }
  };

  return {
    lessons: lessonsWithGate,
    loading,
    refetch: fetchLessons,
    createLesson,
    updateLesson,
    deleteLesson,
    reorderLessons,
    markCompleted,
    markIncomplete,
    addAttachment,
    removeAttachment,
  };
}
