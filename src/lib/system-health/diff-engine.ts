// Diff-движок для двух последних запусков system_health_reports.
// 4 статуса: new (появилась), disappeared (исчезла), count_changed (значение изменилось), unchanged.

export interface InvariantResult {
  code: string;
  passed: boolean;
  count: number;
  name?: string;
}

export type DiffStatus = "new" | "disappeared" | "count_changed" | "unchanged";

export interface DiffEntry {
  code: string;
  status: DiffStatus;
  before: { passed: boolean; count: number } | null;
  after: { passed: boolean; count: number } | null;
  delta: number; // after.count - before.count
}

export function diffInvariants(
  prev: InvariantResult[] | null | undefined,
  curr: InvariantResult[] | null | undefined
): DiffEntry[] {
  const prevMap = new Map((prev ?? []).map((r) => [r.code, r]));
  const currMap = new Map((curr ?? []).map((r) => [r.code, r]));
  const codes = new Set<string>([...prevMap.keys(), ...currMap.keys()]);
  const out: DiffEntry[] = [];

  for (const code of codes) {
    const p = prevMap.get(code);
    const c = currMap.get(code);

    if (!p && c) {
      out.push({
        code,
        status: "new",
        before: null,
        after: { passed: c.passed, count: c.count },
        delta: c.count,
      });
      continue;
    }
    if (p && !c) {
      out.push({
        code,
        status: "disappeared",
        before: { passed: p.passed, count: p.count },
        after: null,
        delta: -p.count,
      });
      continue;
    }
    if (p && c) {
      const sameCount = p.count === c.count;
      const samePassed = p.passed === c.passed;
      out.push({
        code,
        status: sameCount && samePassed ? "unchanged" : "count_changed",
        before: { passed: p.passed, count: p.count },
        after: { passed: c.passed, count: c.count },
        delta: c.count - p.count,
      });
    }
  }
  return out;
}
