import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

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
  // Computed fields
  is_completed?: boolean;
  attachments?: LessonAttachment[];
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
}

export function useTrainingLessons(moduleId?: string) {
  const { user } = useAuth();
  const [lessons, setLessons] = useState<TrainingLesson[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLessons = useCallback(async () => {
    if (!moduleId) {
      setLessons([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
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
        is_completed: completedLessonIds.includes(lesson.id),
        attachments: attachmentsData?.filter(a => a.lesson_id === lesson.id) || [],
      })) || [];

      setLessons(enrichedLessons);
    } catch (error) {
      console.error("Error fetching lessons:", error);
      toast.error("Ошибка загрузки уроков");
    } finally {
      setLoading(false);
    }
  }, [moduleId, user]);

  useEffect(() => {
    fetchLessons();
  }, [fetchLessons]);

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

  return {
    lessons,
    loading,
    refetch: fetchLessons,
    createLesson,
    updateLesson,
    deleteLesson,
    markCompleted,
    markIncomplete,
    addAttachment,
    removeAttachment,
  };
}
