import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { LessonCardData } from "@/components/training/LessonCard";

interface ContainerModule {
  id: string;
  slug: string;
  menu_section_key: string;
}

interface LessonsBySectionResult {
  lessonsBySection: Record<string, { lessons: LessonCardData[]; moduleSlug: string }>;
  containerModules: ContainerModule[];
  isLoading: boolean;
}

/**
 * Fetches lessons from container modules (is_container = true)
 * These lessons display as standalone cards in their sections
 */
export function useContainerLessons(): LessonsBySectionResult {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["container-lessons", user?.id],
    queryFn: async () => {
      // 1. Get all container modules
      const { data: containers, error: containerError } = await supabase
        .from("training_modules")
        .select("id, slug, menu_section_key")
        .eq("is_active", true)
        .eq("is_container", true);

      if (containerError) throw containerError;
      if (!containers?.length) return { containers: [], lessons: [] };

      const containerIds = containers.map((c) => c.id);

      // 2. Get lessons from container modules
      const { data: lessons, error: lessonError } = await supabase
        .from("training_lessons")
        .select(`
          id,
          title,
          slug,
          description,
          thumbnail_url,
          duration_minutes,
          created_at,
          sort_order,
          module_id
        `)
        .in("module_id", containerIds)
        .eq("is_active", true)
        .order("sort_order", { ascending: false })
        .order("created_at", { ascending: false });

      if (lessonError) throw lessonError;

      return { containers, lessons: lessons || [] };
    },
    staleTime: 5 * 60 * 1000,
  });

  // Group lessons by section key
  const lessonsBySection: Record<string, { lessons: LessonCardData[]; moduleSlug: string }> = {};
  const containerModules: ContainerModule[] = data?.containers || [];

  if (data?.containers && data?.lessons) {
    const containerMap = new Map(
      data.containers.map((c) => [c.id, { slug: c.slug, sectionKey: c.menu_section_key }])
    );

    for (const lesson of data.lessons) {
      const container = containerMap.get(lesson.module_id);
      if (!container) continue;

      const sectionKey = container.sectionKey;
      if (!lessonsBySection[sectionKey]) {
        lessonsBySection[sectionKey] = {
          lessons: [],
          moduleSlug: container.slug,
        };
      }

      lessonsBySection[sectionKey].lessons.push({
        id: lesson.id,
        title: lesson.title,
        slug: lesson.slug,
        description: lesson.description,
        cover_image: lesson.thumbnail_url,
        video_duration: lesson.duration_minutes ? lesson.duration_minutes * 60 : null,
        created_at: lesson.created_at,
        sort_order: lesson.sort_order ?? 0,
        has_access: true, // TODO: Check access if needed
      });
    }
  }

  return {
    lessonsBySection,
    containerModules,
    isLoading,
  };
}
