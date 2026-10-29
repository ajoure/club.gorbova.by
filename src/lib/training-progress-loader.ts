import { supabase } from "@/integrations/supabase/client";
import { mergeTrainingProgress, type TrainingProgressRow } from "./training-progress";

type Table = "lesson_progress_state" | "user_lesson_progress" | "lesson_progress";
const PAGE_SIZE = 500;
const LESSON_BATCH_SIZE = 100;
const METADATA = "id,user_id,lesson_id,completed_at,created_at,updated_at";

async function readPages(table: Table, lessons: string[], includeState: boolean) {
  const rows: TrainingProgressRow[] = [];
  const fields = table === "lesson_progress"
    ? "id,user_id,lesson_id,completed_at"
    : METADATA + (table === "lesson_progress_state" && includeState ? ",state_json" : "");
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase.from(table).select(fields).in("lesson_id", lessons).order("id");
    if (table === "user_lesson_progress") query = query.not("response", "is", null);
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data || []) as unknown as TrainingProgressRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/** Reads existing RLS-protected sources; never writes or fetches answer payloads. */
export async function loadTrainingProgress(lessonIds: string[], includeState = false) {
  const ids = [...new Set(lessonIds)].sort();
  const result = [];
  for (let start = 0; start < ids.length; start += LESSON_BATCH_SIZE) {
    const batch = ids.slice(start, start + LESSON_BATCH_SIZE);
    const [states, answers, legacy] = await Promise.all([
      readPages("lesson_progress_state", batch, includeState),
      readPages("user_lesson_progress", batch, false),
      readPages("lesson_progress", batch, false),
    ]);
    result.push(...mergeTrainingProgress(states, answers, legacy));
  }
  return result;
}
