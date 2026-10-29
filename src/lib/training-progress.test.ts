import { describe, expect, it } from "vitest";
import { countTrainingProgress, mergeTrainingProgress, type TrainingProgressRow } from "./training-progress";

const row = (id: string, user = "learner", extra: Partial<TrainingProgressRow> = {}): TrainingProgressRow => ({
  id, user_id: user, lesson_id: "step5", created_at: "2026-10-28T10:00:00Z",
  updated_at: "2026-10-28T10:00:00Z", completed_at: null, ...extra,
});
const done = "2026-10-28T11:00:00Z";

describe("canonical training progress", () => {
  it("counts the actual Step5 shape as 4 learners / 1 completion, not zero or doubled rows", () => {
    const states = [1, 2, 3, 4].map(i => row(`s${i}`, `learner${i}`));
    const answers = [1, 2, 3, 4].map(i => row(`a${i}`, `learner${i}`, { completed_at: i === 1 ? done : null }));
    const records = mergeTrainingProgress(states, answers);
    expect(countTrainingProgress(records).get("step5")).toEqual({ total: 4, completed: 1 });
    expect(records[0].progress_sources).toEqual(["lesson_progress_state", "user_lesson_progress"]);
  });

  it("retains legacy-only completions for ordinary lessons without inflating interactive counts", () => {
    const records = mergeTrainingProgress([row("s")], [row("a")], [row("old"), row("legacy", "older", { completed_at: done })]);
    expect(countTrainingProgress(records).get("step5")).toEqual({ total: 2, completed: 1 });
    expect(records.find(r => r.user_id === "older")?.progress_sources).toEqual(["lesson_progress"]);
  });

  it("does not resurrect an old completion after a newer manual draft", () => {
    const [record] = mergeTrainingProgress(
      [row("s", "learner", { completed_at: done })],
      [row("a", "learner", { updated_at: "2026-10-29T10:00:00Z" })],
      [row("legacy", "learner", { completed_at: done })],
    );
    expect(record.completed_at).toBeNull();
    expect(countTrainingProgress([record]).get("step5")?.completed).toBe(0);
  });

  it("preserves a newer completed state and its full answer payload", () => {
    const state = { answers: { example: "Ёлка, ў, € 🚀" } };
    const [record] = mergeTrainingProgress(
      [row("s", "learner", { updated_at: done, completed_at: done, state_json: state })],
      [row("a")],
    );
    expect(record.completed_at).toBe(done);
    expect(record.state_json).toEqual(state);
    expect(record.id).toBe("s");
  });

  it("uses the latest block answer regardless of input ordering", () => {
    const older = row("older", "learner", { completed_at: done });
    const newer = row("newer", "learner", { updated_at: "2026-10-29T10:00:00Z" });
    expect(mergeTrainingProgress([], [older, newer])).toEqual(mergeTrainingProgress([], [newer, older]));
    expect(mergeTrainingProgress([], [newer, older])[0].completed_at).toBeNull();
  });

  it("deduplicates blocks and separates lessons even for the same learner", () => {
    const records = mergeTrainingProgress([], [row("a"), row("b"), row("c", "learner", { lesson_id: "step2", completed_at: done })]);
    expect(records).toHaveLength(2);
    expect(Object.fromEntries(countTrainingProgress(records))).toEqual({
      step2: { total: 1, completed: 1 }, step5: { total: 1, completed: 0 },
    });
  });

  it("uses a stable tie-breaker and does not mutate saved source rows", () => {
    const source = [row("a"), row("z", "learner", { completed_at: done })];
    const original = structuredClone(source);
    expect(mergeTrainingProgress([], source)).toEqual(mergeTrainingProgress([], [...source].reverse()));
    expect(source).toEqual(original);
  });

  it("supports empty lessons without inventing progress", () => {
    expect(mergeTrainingProgress([], [])).toEqual([]);
    expect(countTrainingProgress([]).size).toBe(0);
  });
});
