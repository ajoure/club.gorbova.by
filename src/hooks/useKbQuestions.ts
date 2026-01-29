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
          created_at,
          lesson:training_lessons(
            slug,
            module:training_modules(slug)
          )
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
      if (error) throw error;

      // Client-side search if query provided (FTS would be better but this works for now)
      let filtered = data as unknown as KbQuestion[];
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
 * - String: "14:20", "1:01:36", "01:14:20"
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

  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
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
