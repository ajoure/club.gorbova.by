import type { FunctionCheckResult } from "./availability.ts";

export interface BusinessEvidence<T> { results: T[]; checked_at: string | null }
export interface MissingEvidence { name: string; checked_at: string }

// A pinned predecessor keeps scan lineage, but it must never replace a newer
// completed business verification from another scan chain.
export function newestBusinessEvidence<T extends { passed: boolean; severity: string }>(
  candidates: BusinessEvidence<T>[],
): BusinessEvidence<T> {
  const score = (e: BusinessEvidence<T>) => Date.parse(e.checked_at || "") || 0;
  const critical = (e: BusinessEvidence<T>) => e.results.filter(r => !r.passed && r.severity === "CRITICAL").length;
  return [...candidates].sort((a, b) => score(b) - score(a) || critical(b) - critical(a))[0]
    || { results: [], checked_at: null };
}

// An unprobed/failed transport cannot clear a confirmed missing P0. Only a
// successful, newer preflight can do so. Evidence survives partial scan pages.
export function retainMissingP0(
  current: FunctionCheckResult[],
  prior: MissingEvidence[],
  otherVerified: FunctionCheckResult[] = [],
): MissingEvidence[] {
  const active = new Map(current.filter(r => r.tier === "P0").map(r => [r.name, r]));
  const evidence = new Map<string, MissingEvidence>();
  for (const item of [...prior, ...current.filter(r => r.tier === "P0" && r.status === "NOT_DEPLOYED" && r.checked_at)
    .map(r => ({ name: r.name, checked_at: r.checked_at! }))]) {
    if (!active.has(item.name) || !Number.isFinite(Date.parse(item.checked_at))) continue;
    const existing = evidence.get(item.name);
    if (!existing || Date.parse(item.checked_at) > Date.parse(existing.checked_at)) evidence.set(item.name, item);
  }
  return [...evidence.values()].filter(item => {
    return ![active.get(item.name)!, ...otherVerified.filter(r => r.name === item.name)].some(fresh =>
      fresh.status === "OK" && fresh.checked_at && Date.parse(fresh.checked_at) > Date.parse(item.checked_at));
  }).sort((a, b) => a.name.localeCompare(b.name));
}
