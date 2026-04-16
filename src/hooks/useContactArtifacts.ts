import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ArtifactSourceType = 'site_form' | 'lesson_answer' | 'lesson_completion' | 'quest_homework';

export interface ContactArtifact {
  id: string;
  source_type: ArtifactSourceType;
  source_id: string;
  title: string;
  subtitle: string | null;
  product_id: string | null;
  product_title: string | null;
  training_title: string | null;
  lesson_title: string | null;
  submitted_at: string;
  status: 'completed' | 'in_progress' | 'new';
  score: number | null;
  max_score: number | null;
  summary: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export function useContactArtifacts(profileId: string | null | undefined, userId: string | null | undefined, enabled: boolean = false) {
  // Site form submissions (by profile_id)
  const formsQuery = useQuery({
    queryKey: ["contact-artifacts-forms", profileId],
    enabled: enabled && !!profileId,
    queryFn: async (): Promise<ContactArtifact[]> => {
      const { data, error } = await supabase
        .from("site_form_submissions")
        .select("id, form_data, metadata, status, created_at, page_id, source, site_pages!site_form_submissions_page_id_fkey(title, slug)")
        .eq("profile_id", profileId!)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[useContactArtifacts] forms error:", error);
        return [];
      }

      return (data || []).map((row: any) => {
        const meta = row.metadata as Record<string, any> || {};
        const pageTitle = row.site_pages?.title || row.site_pages?.slug || null;
        const title = pageTitle ? `Анкета: ${pageTitle}` : "Анкета сайта";
        const formData = (row.form_data || {}) as Record<string, unknown>;

        // Build summary from form_data top-level keys
        const summaryKeys = Object.keys(formData).slice(0, 4);
        const summary: Record<string, unknown> = {};
        summaryKeys.forEach(k => { summary[k] = formData[k]; });

        return {
          id: row.id,
          source_type: 'site_form' as const,
          source_id: row.id,
          title,
          subtitle: row.source || null,
          product_id: meta.product_id || null,
          product_title: meta.product_title || null,
          training_title: null,
          lesson_title: null,
          submitted_at: row.created_at,
          status: row.status === 'processed' ? 'completed' as const : 'new' as const,
          score: null,
          max_score: null,
          summary,
          payload: formData,
        };
      });
    },
  });

  // User lesson progress (by user_id) — individual block answers
  const lessonAnswersQuery = useQuery({
    queryKey: ["contact-artifacts-lesson-answers", userId],
    enabled: enabled && !!userId,
    queryFn: async (): Promise<ContactArtifact[]> => {
      const { data, error } = await supabase
        .from("user_lesson_progress")
        .select(`
          id, lesson_id, block_id, response, is_correct, score, max_score, attempts,
          started_at, completed_at, created_at,
          training_lessons!inner(id, title, module_id,
            training_modules!inner(id, title, product_id,
              products_v2(id, name)
            )
          )
        `)
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });

      if (error) {
        // Fallback without joins if relation fails
        console.error("[useContactArtifacts] lesson answers join error, trying fallback:", error);
        const { data: fallback } = await supabase
          .from("user_lesson_progress")
          .select("id, lesson_id, block_id, response, is_correct, score, max_score, attempts, started_at, completed_at, created_at")
          .eq("user_id", userId!)
          .order("created_at", { ascending: false });

        return (fallback || []).map((row: any) => ({
          id: row.id,
          source_type: 'lesson_answer' as const,
          source_id: row.id,
          title: "Ответ по уроку",
          subtitle: null,
          product_id: null,
          product_title: null,
          training_title: null,
          lesson_title: null,
          submitted_at: row.completed_at || row.created_at,
          status: row.completed_at ? 'completed' as const : 'in_progress' as const,
          score: row.score,
          max_score: row.max_score,
          summary: { is_correct: row.is_correct, attempts: row.attempts },
          payload: (row.response || {}) as Record<string, unknown>,
        }));
      }

      return (data || []).map((row: any) => {
        const lesson = row.training_lessons;
        const module = lesson?.training_modules;
        const product = module?.products_v2;

        return {
          id: row.id,
          source_type: 'lesson_answer' as const,
          source_id: row.id,
          title: lesson?.title || "Ответ по уроку",
          subtitle: module?.title || null,
          product_id: product?.id || module?.product_id || null,
          product_title: product?.name || null,
          training_title: module?.title || null,
          lesson_title: lesson?.title || null,
          submitted_at: row.completed_at || row.created_at,
          status: row.completed_at ? 'completed' as const : 'in_progress' as const,
          score: row.score,
          max_score: row.max_score,
          summary: { is_correct: row.is_correct, attempts: row.attempts, score: row.score, max_score: row.max_score },
          payload: (row.response || {}) as Record<string, unknown>,
        };
      });
    },
  });

  // Lesson progress completions (by user_id) — deduped against lesson answers
  const lessonCompletionsQuery = useQuery({
    queryKey: ["contact-artifacts-lesson-completions", userId],
    enabled: enabled && !!userId,
    queryFn: async (): Promise<ContactArtifact[]> => {
      const { data, error } = await supabase
        .from("lesson_progress")
        .select(`
          id, lesson_id, completed_at, user_id,
          training_lessons!inner(id, title, module_id,
            training_modules!inner(id, title, product_id,
              products_v2(id, name)
            )
          )
        `)
        .eq("user_id", userId!)
        .order("completed_at", { ascending: false });

      if (error) {
        console.error("[useContactArtifacts] lesson completions error:", error);
        return [];
      }

      return (data || []).map((row: any) => {
        const lesson = row.training_lessons;
        const module = lesson?.training_modules;
        const product = module?.products_v2;

        return {
          id: row.id,
          source_type: 'lesson_completion' as const,
          source_id: row.id,
          title: lesson?.title || "Прохождение урока",
          subtitle: module?.title || null,
          product_id: product?.id || module?.product_id || null,
          product_title: product?.name || null,
          training_title: module?.title || null,
          lesson_title: lesson?.title || null,
          submitted_at: row.completed_at,
          status: 'completed' as const,
          score: null,
          max_score: null,
          summary: {},
          payload: {},
        };
      });
    },
  });

  // Quest homework (by user_id)
  const questHomeworkQuery = useQuery({
    queryKey: ["contact-artifacts-quest-homework", userId],
    enabled: enabled && !!userId,
    queryFn: async (): Promise<ContactArtifact[]> => {
      const { data, error } = await supabase
        .from("quest_user_progress")
        .select(`
          id, quest_id, lesson_id, homework_response, is_completed, completed_at, created_at,
          quest_lessons(id, title),
          quests(id, title)
        `)
        .eq("user_id", userId!)
        .not("homework_response", "is", null)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[useContactArtifacts] quest homework error:", error);
        return [];
      }

      return (data || []).map((row: any) => ({
        id: row.id,
        source_type: 'quest_homework' as const,
        source_id: row.id,
        title: (row.quest_lessons as any)?.title || "Домашнее задание",
        subtitle: (row.quests as any)?.title || null,
        product_id: null,
        product_title: null,
        training_title: (row.quests as any)?.title || null,
        lesson_title: (row.quest_lessons as any)?.title || null,
        submitted_at: row.completed_at || row.created_at,
        status: row.is_completed ? 'completed' as const : 'in_progress' as const,
        score: null,
        max_score: null,
        summary: {},
        payload: (row.homework_response || {}) as Record<string, unknown>,
      }));
    },
  });

  // Aggregate and deduplicate
  const allArtifacts: ContactArtifact[] = (() => {
    const forms = formsQuery.data || [];
    const answers = lessonAnswersQuery.data || [];
    const completions = lessonCompletionsQuery.data || [];
    const homework = questHomeworkQuery.data || [];

    // Dedup: if lesson has answers, don't show bare completion
    const answeredLessonIds = new Set(answers.map(a => {
      // Extract lesson_id — it's stored in source but we need to match
      // We match by lesson_title as a proxy since lesson_id isn't directly in artifact
      return a.lesson_title;
    }).filter(Boolean));

    // Actually better: collect lesson_ids from raw data
    const answeredLessonIdSet = new Set<string>();
    (lessonAnswersQuery.data || []).forEach((a: any) => {
      // We need lesson_id but it's not in the artifact type directly
      // Let's use a different approach: check by lesson_title match
    });

    // Simpler dedup: filter completions whose lesson_title already has an answer
    const dedupedCompletions = completions.filter(c => {
      if (!c.lesson_title) return true;
      return !answers.some(a => a.lesson_title === c.lesson_title);
    });

    const all = [...forms, ...answers, ...dedupedCompletions, ...homework];

    // Sort: primary by date DESC, secondary by source_type, id
    all.sort((a, b) => {
      const dateA = new Date(a.submitted_at || 0).getTime();
      const dateB = new Date(b.submitted_at || 0).getTime();
      if (dateB !== dateA) return dateB - dateA;
      if (a.source_type !== b.source_type) return a.source_type.localeCompare(b.source_type);
      return a.id.localeCompare(b.id);
    });

    return all;
  })();

  const isLoading = formsQuery.isLoading || lessonAnswersQuery.isLoading || lessonCompletionsQuery.isLoading || questHomeworkQuery.isLoading;

  return {
    artifacts: allArtifacts,
    isLoading,
    formCount: (formsQuery.data || []).length,
    trainingCount: (lessonAnswersQuery.data || []).length + 
      allArtifacts.filter(a => a.source_type === 'lesson_completion').length +
      (questHomeworkQuery.data || []).length,
    totalCount: allArtifacts.length,
  };
}
