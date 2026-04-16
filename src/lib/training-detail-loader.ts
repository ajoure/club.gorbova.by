/**
 * Shared canonical loader for training lesson detail context.
 * Used by ContactArtifactsTab (contact card) and FormsDetailOpener (forms hub).
 * Single source of truth — do NOT duplicate this logic elsewhere.
 */

import { supabase } from "@/integrations/supabase/client";
import type { LessonProgressRecord, LessonBlock } from "@/components/admin/trainings/StudentProgressModal";

export interface TrainingDetailData {
  record: LessonProgressRecord;
  lessonBlocks: LessonBlock[];
  blockResponses: Record<string, any>;
}

/**
 * Loads all data needed to open StudentProgressModal for a given user+lesson.
 * Canonical tables: lesson_progress_state, lesson_blocks, user_lesson_progress.
 * Fallback: if lesson_progress_state is missing, synthesises a minimal record
 * so the modal still opens with blocks/responses.
 * Returns null only when there are no blocks AND no responses (nothing to show).
 */
export async function loadTrainingDetailContext(
  userId: string,
  lessonId: string,
): Promise<TrainingDetailData | null> {
  const [stateRes, blocksRes, progressRes] = await Promise.all([
    supabase
      .from("lesson_progress_state")
      .select("id, user_id, lesson_id, state_json, completed_at, created_at, updated_at")
      .eq("user_id", userId)
      .eq("lesson_id", lessonId)
      .maybeSingle(),
    supabase
      .from("lesson_blocks")
      .select("id, block_type, content")
      .eq("lesson_id", lessonId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("user_lesson_progress")
      .select("block_id, response")
      .eq("user_id", userId)
      .eq("lesson_id", lessonId),
  ]);

  const lessonBlocks = (blocksRes.data || []) as LessonBlock[];
  const blockResponses: Record<string, any> = {};
  (progressRes.data || []).forEach((row: any) => {
    if (row.block_id && row.response) {
      blockResponses[row.block_id] = row.response;
    }
  });

  // If there's absolutely nothing to show — signal to caller
  if (lessonBlocks.length === 0 && Object.keys(blockResponses).length === 0 && !stateRes.data) {
    return null;
  }

  const stateRow = stateRes.data;
  const record: LessonProgressRecord = stateRow
    ? {
        id: stateRow.id,
        user_id: stateRow.user_id,
        lesson_id: stateRow.lesson_id,
        state_json: stateRow.state_json || {},
        completed_at: stateRow.completed_at,
        created_at: stateRow.created_at,
        updated_at: stateRow.updated_at,
      }
    : {
        id: "",
        user_id: userId,
        lesson_id: lessonId,
        state_json: {},
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

  return { record, lessonBlocks, blockResponses };
}
