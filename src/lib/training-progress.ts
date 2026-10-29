/** One learner per lesson, shared by the training summary and answer viewer. */
export interface TrainingProgressRow {
  id: string;
  user_id: string;
  lesson_id: string;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  state_json?: unknown;
}

type ProgressSource = "lesson_progress_state" | "user_lesson_progress" | "lesson_progress";

export interface TrainingProgressRecord {
  id: string;
  user_id: string;
  lesson_id: string;
  state_json: unknown;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  progress_sources: ProgressSource[];
}

const timestamp = (row: TrainingProgressRow) =>
  row.updated_at || row.created_at || row.completed_at || "1970-01-01T00:00:00.000Z";
const millis = (value: string) => Date.parse(value) || 0;
const key = (row: TrainingProgressRow) => `${row.lesson_id}:${row.user_id}`;

function latestPerLearner(rows: TrainingProgressRow[]) {
  const result = new Map<string, TrainingProgressRow>();
  for (const row of rows) {
    const previous = result.get(key(row));
    const delta = previous ? millis(timestamp(row)) - millis(timestamp(previous)) : 1;
    if (!previous || delta > 0 || (delta === 0 && row.id > previous.id)) {
      result.set(key(row), row);
    }
  }
  return result;
}

export function mergeTrainingProgress(
  stateRows: TrainingProgressRow[],
  answerRows: TrainingProgressRow[],
  legacyRows: TrainingProgressRow[] = [],
): TrainingProgressRecord[] {
  const states = latestPerLearner(stateRows);
  const answers = latestPerLearner(answerRows);
  const legacy = latestPerLearner(legacyRows);
  const result: TrainingProgressRecord[] = [];

  for (const learnerKey of new Set([...states.keys(), ...answers.keys(), ...legacy.keys()])) {
    const state = states.get(learnerKey);
    const answer = answers.get(learnerKey);
    const fallback = legacy.get(learnerKey);
    const base = state || answer || fallback!;
    // Preserve the canonical detail-view rule: a newer manual draft clears
    // completion; older manual answers cannot undo a newer completed state.
    const answerNewer = answer && (!state || millis(timestamp(answer)) > millis(timestamp(state)));
    const interactiveCompletedAt = state
      ? answerNewer ? answer!.completed_at || null : state.completed_at || answer?.completed_at || null
      : (answer || fallback)!.completed_at || null;
    // lesson_progress is the explicit "mark lesson complete" flag. Autosaving
    // an answer must not erase it. The canonical markIncomplete action deletes
    // that flag; workshop draft/review status remains independent and unchanged.
    const completedAt = fallback?.completed_at || interactiveCompletedAt;
    const sources: ProgressSource[] = state || answer
      ? [...(state ? ["lesson_progress_state" as const] : []), ...(answer ? ["user_lesson_progress" as const] : []), ...(fallback ? ["lesson_progress" as const] : [])]
      : ["lesson_progress"];
    result.push({
      id: state?.id || `manual:${base.lesson_id}:${base.user_id}`,
      user_id: base.user_id,
      lesson_id: base.lesson_id,
      state_json: state?.state_json || {},
      completed_at: completedAt,
      created_at: base.created_at || base.completed_at || timestamp(base),
      updated_at: answerNewer ? timestamp(answer!) : timestamp(base),
      progress_sources: sources,
    });
  }
  return result.sort((a, b) => millis(b.updated_at) - millis(a.updated_at) || a.id.localeCompare(b.id));
}

export function countTrainingProgress(records: TrainingProgressRecord[]) {
  const counts = new Map<string, { total: number; completed: number }>();
  for (const record of records) {
    const count = counts.get(record.lesson_id) || { total: 0, completed: 0 };
    count.total++;
    if (record.completed_at) count.completed++;
    counts.set(record.lesson_id, count);
  }
  return counts;
}
