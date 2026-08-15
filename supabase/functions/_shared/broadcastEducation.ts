export type EducationStatus =
  | "lesson_completed"
  | "lesson_not_completed"
  | "homework_submitted"
  | "homework_not_submitted"
  | "form_answered"
  | "form_not_answered";

export interface EducationCondition {
  module_id?: string | null;
  lesson_id: string;
  status: EducationStatus;
}

const HOMEWORK_BLOCK_TYPES = ["file_upload", "input_long", "table_input"];
const FORM_BLOCK_TYPES = [
  "quiz_survey",
  "sequential_form",
  "diagnostic_table",
  "input_short",
  "checklist",
  "rating",
  "quiz_single",
  "quiz_multiple",
  "quiz_true_false",
  "quiz_fill_blank",
  "quiz_matching",
  "quiz_sequence",
  "quiz_hotspot",
];

export function parseEducationCondition(value: unknown): EducationCondition | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const lessonId = typeof raw.lesson_id === "string" ? raw.lesson_id : "";
  const status = typeof raw.status === "string" ? raw.status as EducationStatus : null;
  const allowed: EducationStatus[] = [
    "lesson_completed",
    "lesson_not_completed",
    "homework_submitted",
    "homework_not_submitted",
    "form_answered",
    "form_not_answered",
  ];
  if (!lessonId || !status || !allowed.includes(status)) return null;
  return {
    lesson_id: lessonId,
    module_id: typeof raw.module_id === "string" ? raw.module_id : null,
    status,
  };
}

export async function filterUsersByEducationCondition(
  supabase: any,
  candidateUserIds: string[],
  conditionValue: unknown,
): Promise<Set<string>> {
  const condition = parseEducationCondition(conditionValue);
  const candidates = new Set(candidateUserIds.filter(Boolean));
  if (!condition || candidates.size === 0) return candidates;

  let matched = new Set<string>();

  if (condition.status === "lesson_completed" || condition.status === "lesson_not_completed") {
    const { data, error } = await supabase
      .from("lesson_progress")
      .select("user_id")
      .eq("lesson_id", condition.lesson_id)
      .in("user_id", [...candidates]);
    if (error) throw new Error(`education_lesson_progress_failed:${error.message}`);
    matched = new Set((data || []).map((row: { user_id: string }) => row.user_id));
  } else {
    const blockTypes = condition.status.startsWith("homework_")
      ? HOMEWORK_BLOCK_TYPES
      : FORM_BLOCK_TYPES;
    const { data: blocks, error: blockError } = await supabase
      .from("lesson_blocks")
      .select("id")
      .eq("lesson_id", condition.lesson_id)
      .in("block_type", blockTypes);
    if (blockError) throw new Error(`education_blocks_failed:${blockError.message}`);
    const blockIds = (blocks || []).map((row: { id: string }) => row.id);
    if (blockIds.length > 0) {
      const { data, error } = await supabase
        .from("user_lesson_progress")
        .select("user_id, completed_at, response")
        .eq("lesson_id", condition.lesson_id)
        .in("block_id", blockIds)
        .in("user_id", [...candidates]);
      if (error) throw new Error(`education_responses_failed:${error.message}`);
      matched = new Set(
        (data || [])
          .filter((row: { completed_at: string | null; response: unknown }) => {
            if (row.completed_at) return true;
            if (!row.response || typeof row.response !== "object") return false;
            return Object.keys(row.response as Record<string, unknown>).length > 0;
          })
          .map((row: { user_id: string }) => row.user_id),
      );
    }
  }

  const negative = condition.status.endsWith("_not_completed")
    || condition.status.endsWith("_not_submitted")
    || condition.status.endsWith("_not_answered");
  return negative
    ? new Set([...candidates].filter((userId) => !matched.has(userId)))
    : new Set([...candidates].filter((userId) => matched.has(userId)));
}
