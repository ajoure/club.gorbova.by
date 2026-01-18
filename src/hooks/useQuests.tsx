import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface Quest {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  cover_image: string | null;
  color_gradient: string | null;
  total_lessons: number;
  is_active: boolean;
  is_free: boolean;
  sort_order: number;
  created_at: string;
}

export interface QuestLesson {
  id: string;
  quest_id: string;
  title: string;
  slug: string;
  description: string | null;
  video_id: string | null;
  homework_text: string | null;
  homework_file_url: string | null;
  sort_order: number;
  duration_minutes: number | null;
  is_active: boolean;
}

export interface QuestProgress {
  lesson_id: string;
  is_completed: boolean;
  completed_at: string | null;
  watched_seconds: number;
}

export interface QuestWithProgress extends Quest {
  completedLessons: number;
  nextLessonSlug: string | null;
}

export function useQuests() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Fetch all quests with user progress
  const { data: quests, isLoading, error } = useQuery({
    queryKey: ["quests", user?.id],
    queryFn: async (): Promise<QuestWithProgress[]> => {
      const { data: questsData, error: questsError } = await supabase
        .from("quests")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");

      if (questsError) throw questsError;
      if (!questsData?.length) return [];

      // Fetch all lessons
      const { data: lessons } = await supabase
        .from("quest_lessons")
        .select("id, quest_id, slug, sort_order")
        .eq("is_active", true)
        .order("sort_order");

      // Fetch user progress
      const { data: progress } = await supabase
        .from("quest_user_progress")
        .select("lesson_id, is_completed")
        .eq("user_id", user?.id || "");

      const completedLessonIds = new Set(
        progress?.filter(p => p.is_completed).map(p => p.lesson_id) || []
      );

      return questsData.map(quest => {
        const questLessons = lessons?.filter(l => l.quest_id === quest.id) || [];
        const completedLessons = questLessons.filter(l => completedLessonIds.has(l.id)).length;

        // Find next incomplete lesson
        let nextLessonSlug: string | null = null;
        for (const lesson of questLessons) {
          if (!completedLessonIds.has(lesson.id)) {
            nextLessonSlug = lesson.slug;
            break;
          }
        }

        return {
          ...quest,
          completedLessons,
          nextLessonSlug,
        };
      });
    },
    enabled: !!user?.id,
  });

  return { quests, isLoading, error };
}

export function useQuestLessons(questSlug: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["quest-lessons", questSlug, user?.id],
    queryFn: async () => {
      // First get the quest
      const { data: quest, error: questError } = await supabase
        .from("quests")
        .select("*")
        .eq("slug", questSlug)
        .eq("is_active", true)
        .single();

      if (questError) throw questError;

      // Get lessons
      const { data: lessons, error: lessonsError } = await supabase
        .from("quest_lessons")
        .select("*")
        .eq("quest_id", quest.id)
        .eq("is_active", true)
        .order("sort_order");

      if (lessonsError) throw lessonsError;

      // Get user progress
      const { data: progress } = await supabase
        .from("quest_user_progress")
        .select("lesson_id, is_completed, completed_at, watched_seconds")
        .eq("user_id", user?.id || "")
        .eq("quest_id", quest.id);

      const progressMap = new Map(
        progress?.map(p => [p.lesson_id, p]) || []
      );

      // Add progress and access status to lessons
      const lessonsWithProgress = lessons?.map((lesson, index) => {
        const lessonProgress = progressMap.get(lesson.id);
        const isCompleted = lessonProgress?.is_completed || false;

        // Access logic: first lesson always accessible, others need previous completed
        let isAccessible = index === 0;
        if (index > 0 && lessons) {
          const prevLesson = lessons[index - 1];
          const prevProgress = progressMap.get(prevLesson.id);
          isAccessible = prevProgress?.is_completed || false;
        }

        return {
          ...lesson,
          isCompleted,
          isAccessible,
          watchedSeconds: lessonProgress?.watched_seconds || 0,
          completedAt: lessonProgress?.completed_at || null,
        };
      });

      const completedCount = lessonsWithProgress?.filter(l => l.isCompleted).length || 0;

      return {
        quest,
        lessons: lessonsWithProgress || [],
        completedCount,
        totalCount: lessons?.length || 0,
      };
    },
    enabled: !!user?.id && !!questSlug,
  });
}

export function useQuestLesson(questSlug: string, lessonSlug: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["quest-lesson", questSlug, lessonSlug, user?.id],
    queryFn: async () => {
      // Get quest
      const { data: quest, error: questError } = await supabase
        .from("quests")
        .select("*")
        .eq("slug", questSlug)
        .single();

      if (questError) throw questError;

      // Get lesson
      const { data: lesson, error: lessonError } = await supabase
        .from("quest_lessons")
        .select("*")
        .eq("quest_id", quest.id)
        .eq("slug", lessonSlug)
        .single();

      if (lessonError) throw lessonError;

      // Get all lessons to find prev/next and check access
      const { data: allLessons } = await supabase
        .from("quest_lessons")
        .select("id, slug, sort_order, title")
        .eq("quest_id", quest.id)
        .eq("is_active", true)
        .order("sort_order");

      // Get user progress
      const { data: progress } = await supabase
        .from("quest_user_progress")
        .select("*")
        .eq("user_id", user?.id || "")
        .eq("quest_id", quest.id);

      const progressMap = new Map(
        progress?.map(p => [p.lesson_id, p]) || []
      );

      const currentIndex = allLessons?.findIndex(l => l.id === lesson.id) || 0;
      const prevLesson = currentIndex > 0 ? allLessons?.[currentIndex - 1] : null;
      const nextLesson = currentIndex < (allLessons?.length || 0) - 1 ? allLessons?.[currentIndex + 1] : null;

      // Check if accessible
      let isAccessible = currentIndex === 0;
      if (currentIndex > 0 && allLessons) {
        const prevLessonData = allLessons[currentIndex - 1];
        const prevProgress = progressMap.get(prevLessonData.id);
        isAccessible = prevProgress?.is_completed || false;
      }

      const lessonProgress = progressMap.get(lesson.id);

      return {
        quest,
        lesson: {
          ...lesson,
          isCompleted: lessonProgress?.is_completed || false,
          isAccessible,
          watchedSeconds: lessonProgress?.watched_seconds || 0,
        },
        currentIndex,
        totalLessons: allLessons?.length || 0,
        prevLesson,
        nextLesson,
      };
    },
    enabled: !!user?.id && !!questSlug && !!lessonSlug,
  });

  const markComplete = useMutation({
    mutationFn: async () => {
      if (!data?.lesson || !data?.quest) return;

      const { error } = await supabase
        .from("quest_user_progress")
        .upsert({
          user_id: user?.id,
          quest_id: data.quest.id,
          lesson_id: data.lesson.id,
          is_completed: true,
          completed_at: new Date().toISOString(),
        }, {
          onConflict: "user_id,lesson_id",
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quest-lesson", questSlug, lessonSlug] });
      queryClient.invalidateQueries({ queryKey: ["quest-lessons", questSlug] });
      queryClient.invalidateQueries({ queryKey: ["quests"] });
      toast.success("Урок отмечен как пройденный!");
    },
    onError: () => {
      toast.error("Не удалось отметить урок");
    },
  });

  return { data, isLoading, error, markComplete };
}
