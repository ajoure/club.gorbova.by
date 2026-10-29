import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainingProgressRow } from "./training-progress";
const { from, calls, storage, failures } = vi.hoisted(() => ({
  from: vi.fn(), calls: [] as { table: string; fields: string; ids: string[]; offset: number; end: number; ordered: boolean; onlyResponses: boolean }[],
  storage: {} as Record<string, TrainingProgressRow[]>, failures: new Set<string>(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
import { loadTrainingProgress } from "./training-progress-loader";

beforeEach(() => {
  from.mockReset();
  calls.length = 0;
  failures.clear();
  for (const k of Object.keys(storage)) delete storage[k];
  from.mockImplementation((table: string) => {
    const call = { table, fields: "", ids: [] as string[], offset: 0, end: 0, ordered: false, onlyResponses: false };
    const query = {
      select: (fields: string) => { call.fields = fields; return query; },
      in: (_key: string, ids: string[]) => { call.ids = ids; return query; },
      order: (key: string) => { call.ordered = key === "id"; return query; },
      not: (key: string, operator: string, value: unknown) => {
        call.onlyResponses = key === "response" && operator === "is" && value === null;
        return query;
      },
      range: async (offset: number, end: number) => {
        calls.push({ ...call, offset, end });
        const rows = (storage[table] || []).filter(r => call.ids.includes(r.lesson_id));
        return { data: rows.slice(offset, end + 1), error: failures.has(table) ? new Error("read failed") : null };
      },
    };
    return query;
  });
});

describe("complete RLS-protected progress reads", () => {
  it("paginates beyond the default API limit and counts each learner once", async () => {
    const rows = Array.from({ length: 1003 }, (_, i) => ({ id: String(i), user_id: `learner${i}`, lesson_id: "step5" }));
    storage.lesson_progress_state = rows;
    storage.user_lesson_progress = rows;
    expect(await loadTrainingProgress(["step5"])).toHaveLength(1003);
    expect(calls.filter(c => c.table === "lesson_progress_state").map(c => [c.offset, c.end])).toEqual([[0, 499], [500, 999], [1000, 1499]]);
    expect(calls.every(c => c.ordered)).toBe(true);
    expect(calls.filter(c => c.table === "user_lesson_progress").every(c => c.onlyResponses)).toBe(true);
  });

  it("batches lesson filters and removes duplicate IDs", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `step${i}`);
    await loadTrainingProgress([...ids, ids[0]]);
    expect(calls).toHaveLength(6);
    expect(calls.every(c => c.ids.length <= 100)).toBe(true);
    expect(new Set(calls.flatMap(c => c.ids)).size).toBe(101);
  });

  it("does not transfer answers or state payloads for summary counts", async () => {
    await loadTrainingProgress(["step5"]);
    expect(calls.every(c => !c.fields.includes("response") && !c.fields.includes("state_json") && !c.fields.includes("*"))).toBe(true);
    calls.length = 0;
    await loadTrainingProgress(["step5"], true);
    expect(calls.find(c => c.table === "lesson_progress_state")?.fields).toContain("state_json");
    expect(calls.find(c => c.table === "user_lesson_progress")?.fields).not.toContain("response");
  });

  it.each(["lesson_progress_state", "user_lesson_progress", "lesson_progress"])("rejects partial %s reads instead of displaying false zeros", async table => {
    failures.add(table);
    await expect(loadTrainingProgress(["step5"])).rejects.toThrow("read failed");
  });

  it("does not issue requests for an empty lesson list", async () => {
    expect(await loadTrainingProgress([])).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});
