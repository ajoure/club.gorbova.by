import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { LessonCardData } from "@/components/training/LessonCard";

interface ContainerModule {
  id: string;
  slug: string;
  menu_section_key: string;
}

interface LessonsBySectionResult {
  lessonsBySection: Record<string, { lessons: LessonCardData[]; moduleSlug: string }>;
  containerModules: ContainerModule[];
  restrictedTariffs: string[];
  isLoading: boolean;
}

/**
 * Fetches lessons from container modules (is_container = true)
 * These lessons display as standalone cards in their sections
 */
export function useContainerLessons(): LessonsBySectionResult {
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const isAdminUser = isAdmin();

  const { data, isLoading } = useQuery({
    queryKey: ["container-lessons", user?.id, isAdminUser],
    queryFn: async () => {
      // 1. Get all container modules
      const { data: containers, error: containerError } = await supabase
        .from("training_modules")
        .select("id, slug, menu_section_key")
        .eq("is_active", true)
        .eq("is_container", true);

      if (containerError) throw containerError;
      if (!containers?.length) return { containers: [], lessons: [], accessByContainer: {}, tariffNames: {} };

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
          published_at,
          sort_order,
          module_id
        `)
        .in("module_id", containerIds)
        .eq("is_active", true)
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("sort_order", { ascending: false })
        .order("created_at", { ascending: false });

      if (lessonError) throw lessonError;

      // 3. Get module_access for container modules with tariff names
      const { data: containerAccess } = await supabase
        .from("module_access")
        .select("module_id, tariff_id, tariffs(name)")
        .in("module_id", containerIds);

      const accessByContainer: Record<string, string[]> = {};
      const tariffNames: Record<string, string> = {};
      
      containerAccess?.forEach((a) => {
        if (!accessByContainer[a.module_id]) {
          accessByContainer[a.module_id] = [];
        }
        accessByContainer[a.module_id].push(a.tariff_id);
        const name = (a.tariffs as any)?.name;
        if (name) {
          tariffNames[a.tariff_id] = name;
        }
      });

      // 4. Get user's active tariff IDs if logged in
      let userTariffIds: string[] = [];
      if (user) {
        const { data: subs } = await supabase
          .from("subscriptions_v2")
          .select("tariff_id")
          .eq("user_id", user.id)
          .in("status", ["active", "trial"]);

        userTariffIds = subs?.map((s) => s.tariff_id).filter(Boolean) || [];
      }

      return { containers, lessons: lessons || [], accessByContainer, tariffNames, userTariffIds };
    },
    staleTime: 5 * 60 * 1000,
  });

  // Group lessons by section key
  const lessonsBySection: Record<string, { lessons: LessonCardData[]; moduleSlug: string }> = {};
  const containerModules: ContainerModule[] = data?.containers || [];
  const restrictedTariffIds = new Set<string>();

  if (data?.containers && data?.lessons) {
    const containerMap = new Map<string, { slug: string; sectionKey: string }>();
    for (const c of data.containers) {
      containerMap.set(c.id, { slug: c.slug, sectionKey: c.menu_section_key });
    }

    const accessByContainer = data.accessByContainer || {};
    const userTariffIds = data.userTariffIds || [];
    const tariffNames = data.tariffNames || {};

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

      // Access check: admin OR no restrictions OR user has required tariff
      const containerTariffs = accessByContainer[lesson.module_id] || [];
      const hasAccess = isAdminUser || 
        containerTariffs.length === 0 || 
        containerTariffs.some((tid: string) => userTariffIds.includes(tid));

      // Collect restricted tariff names for banner
      if (!hasAccess && containerTariffs.length > 0) {
        containerTariffs.forEach((tid: string) => {
          if (tariffNames[tid]) {
            restrictedTariffIds.add(tariffNames[tid]);
          }
        });
      }

      lessonsBySection[sectionKey].lessons.push({
        id: lesson.id,
        title: lesson.title,
        slug: lesson.slug,
        description: lesson.description,
        cover_image: lesson.thumbnail_url,
        video_duration: lesson.duration_minutes ? lesson.duration_minutes * 60 : null,
        created_at: lesson.created_at,
        published_at: lesson.published_at,
        sort_order: lesson.sort_order ?? 0,
        has_access: hasAccess,
      });
    }
  }

  return {
    lessonsBySection,
    containerModules,
    restrictedTariffs: Array.from(restrictedTariffIds),
    isLoading,
  };
}
