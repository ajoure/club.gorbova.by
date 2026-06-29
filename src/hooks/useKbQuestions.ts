import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface KbQuestion {
  id: string;
  lesson_id: string;
  episode_number: number;
  question_number: number | null;
  title: string;
  full_question: string | null;
  tags: string[] | null;
  kinescope_url: string | null;
  timecode_seconds: number | null;
  answer_date: string;
  created_at: string;
  lesson?: {
    slug: string;
    module: {
      slug: string;
    } | null;
  } | null;
}

type KbQuestionRow = Omit<KbQuestion, "lesson">;

type LessonSlugRow = {
  id: string;
  slug: string;
  module_id: string | null;
};

type ModuleSlugRow = {
  id: string;
  slug: string;
};

interface UseKbQuestionsOptions {
  searchQuery?: string;
  episodeNumber?: number;
  lessonId?: string;
  limit?: number;
}

/**
 * Hook to fetch KB questions with optional search and filtering
 */
export function useKbQuestions(options: UseKbQuestionsOptions = {}) {
  const { searchQuery, episodeNumber, lessonId, limit = 100 } = options;

  return useQuery({
    queryKey: ["kb-questions", searchQuery, episodeNumber, lessonId, limit],
    queryFn: async () => {
      // PATCH-KNOWLEDGE-RUNTIME-NO-EMBEDDED-SELECT:
      // Продовый PostgREST embedded select kb_questions -> training_lessons -> training_modules
      // под обычным authenticated-пользователем может упираться в тяжелые RLS-политики связанных
      // таблиц и падать по statement timeout. Сначала грузим сами вопросы плоским SELECT'ом
      // (это быстрый и достаточный path для отображения карточек), а slug-и для ссылки на видео
      // догружаем отдельными best-effort запросами. Ошибка во вторичных запросах не должна
      // превращать базу знаний в пустой экран.
      let query = supabase
        .from("kb_questions")
        .select(`
          id,
          lesson_id,
          episode_number,
          question_number,
          title,
          full_question,
          tags,
          kinescope_url,
          timecode_seconds,
          answer_date,
          created_at
        `)
        .order("answer_date", { ascending: false })
        .order("question_number", { ascending: true })
        .limit(limit);

      // Filter by episode number
      if (episodeNumber) {
        query = query.eq("episode_number", episodeNumber);
      }

      // Filter by lesson ID
      if (lessonId) {
        query = query.eq("lesson_id", lessonId);
      }

      const { data, error } = await query;
      if (error) {
        console.error("[useKbQuestions] fetch error", error);
        throw error;
      }

      const rows = (data || []) as KbQuestionRow[];
      let questionsWithLinks: KbQuestion[] = rows.map((q) => ({ ...q, lesson: null }));

      const lessonIds = Array.from(new Set(rows.map((q) => q.lesson_id).filter(Boolean)));
      if (lessonIds.length > 0) {
        try {
          const { data: lessonsData, error: lessonsError } = await supabase
            .from("training_lessons")
            .select("id, slug, module_id")
            .in("id", lessonIds);

          if (lessonsError) {
            console.warn("[useKbQuestions] lesson slug fetch skipped", lessonsError);
          } else {
            const lessons = (lessonsData || []) as LessonSlugRow[];
            const moduleIds = Array.from(new Set(lessons.map((l) => l.module_id).filter(Boolean) as string[]));
            const moduleSlugById = new Map<string, string>();

            if (moduleIds.length > 0) {
              const { data: modulesData, error: modulesError } = await supabase
                .from("training_modules")
                .select("id, slug")
                .in("id", moduleIds);

              if (modulesError) {
                console.warn("[useKbQuestions] module slug fetch skipped", modulesError);
              } else {
                ((modulesData || []) as ModuleSlugRow[]).forEach((m) => moduleSlugById.set(m.id, m.slug));
              }
            }

            const lessonById = new Map<string, KbQuestion["lesson"]>();
            lessons.forEach((lesson) => {
              lessonById.set(lesson.id, {
                slug: lesson.slug,
                module: lesson.module_id && moduleSlugById.has(lesson.module_id)
                  ? { slug: moduleSlugById.get(lesson.module_id)! }
                  : null,
              });
            });

            questionsWithLinks = rows.map((q) => ({
              ...q,
              lesson: lessonById.get(q.lesson_id) || null,
            }));
          }
        } catch (linkError) {
          console.warn("[useKbQuestions] video link metadata fetch skipped", linkError);
        }
      }

      // Client-side search if query provided (FTS would be better but this works for now)
      let filtered = questionsWithLinks;
      if (searchQuery && searchQuery.trim()) {
        const lowerQuery = searchQuery.toLowerCase();
        filtered = filtered.filter(
          (q) =>
            q.title.toLowerCase().includes(lowerQuery) ||
            (q.full_question && q.full_question.toLowerCase().includes(lowerQuery))
        );
      }

      return filtered;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch questions for a specific lesson (for display under video)
 */
export function useLessonQuestions(lessonId: string | undefined) {
  return useQuery({
    queryKey: ["lesson-questions", lessonId],
    queryFn: async () => {
      if (!lessonId) return [];
      
      const { data, error } = await supabase
        .from("kb_questions")
        .select("*")
        .eq("lesson_id", lessonId)
        .order("timecode_seconds", { ascending: true });
      
      if (error) throw error;
      return data as KbQuestion[];
    },
    enabled: !!lessonId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Format timecode seconds to mm:ss or hh:mm:ss
 */
export function formatTimecode(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "00:00";
  
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Parse timecode to seconds
 * Supports formats:
 * - String: "14:20" (mm:ss), "1:01:36" (h:mm:ss), "01:14:20" (hh:mm:ss)
 * - String: "33:55:00" (mm:ss:00 - common export artifact, treat as mm:ss)
 * - Number (Excel time): 0.11319 (fraction of day), 2.0638 (decimal hours)
 */
export function parseTimecode(
  timecode: string | number | undefined | null
): number | null {
  if (timecode === null || timecode === undefined) return null;

  // Excel numeric formats
  if (typeof timecode === "number") {
    if (!Number.isFinite(timecode) || timecode <= 0) return null;

    // fraction of day (Excel time) - 0.5 = 12:00:00
    if (timecode < 1) return Math.round(timecode * 86400);

    // decimal hours (rare but seen in preview) - 2.0638 ≈ 02:03:49
    if (timecode <= 24) return Math.round(timecode * 3600);

    // fallback: assume already seconds
    return Math.round(timecode);
  }

  const cleaned = String(timecode).trim();
  if (!cleaned) return null;

  const parts = cleaned.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;

  // Format: HH:MM:SS or MM:SS:00 (trailing :00 is garbage)
  if (parts.length === 3) {
    // If last part is 00 and first part > 23 -> treat as mm:ss:garbage
    if (parts[2] === 0 && parts[0] >= 24) {
      return parts[0] * 60 + parts[1];
    }
    // If first part > 23 -> probably mm:ss:garbage
    if (parts[0] > 23) {
      return parts[0] * 60 + parts[1];
    }
    // Standard HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  
  // Format: MM:SS
  if (parts.length === 2) return parts[0] * 60 + parts[1];

  return null;
}

/**
 * Build Kinescope URL with timecode (share-link format, NOT embed)
 * Result: https://kinescope.io/<VIDEO_ID>?t=<seconds>
 */
export function buildKinescopeUrlWithTimecode(
  baseUrl: string | null | undefined,
  timecodeSeconds: number | null
): string {
  if (!baseUrl) return "#";

  let url = String(baseUrl).trim();
  if (!url) return "#";

  // normalize: remove /embed/ if ever present
  url = url.replace("kinescope.io/embed/", "kinescope.io/");

  // remove existing t= parameter
  url = url.replace(/[?&]t=\d+/g, "");

  if (timecodeSeconds && timecodeSeconds > 0) {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}t=${Math.floor(timecodeSeconds)}`;
  }

  return url;
}
