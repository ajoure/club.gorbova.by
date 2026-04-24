// Strict legacy-noise filter for SHDF (system_health_discovery_findings).
// ВАЖНО: фильтрация только по паре (decision='exclude', note содержит source_invariant=).
// Без этого фильтра в legacy-блок попадает технический шум (F999 и пр.), что искажает картину.

export const LEGACY_NOISE_FILTER_SQL = `decision = 'exclude' AND note ILIKE '%source_invariant=%'`;

export function extractSourceInvariant(note: string | null | undefined): string | null {
  if (!note) return null;
  const m = note.match(/source_invariant=([A-Z0-9-]+)/i);
  return m ? m[1].toUpperCase() : null;
}

export interface LegacyNoiseRow {
  decision: string | null;
  note: string | null;
}

export interface LegacyNoiseBreakdown {
  total: number;
  bySourceInvariant: Array<{ code: string; count: number }>;
}

export function buildLegacyNoiseBreakdown(rows: LegacyNoiseRow[]): LegacyNoiseBreakdown {
  const filtered = rows.filter(
    (r) => r.decision === "exclude" && (r.note ?? "").toLowerCase().includes("source_invariant=")
  );
  const map = new Map<string, number>();
  for (const r of filtered) {
    const code = extractSourceInvariant(r.note);
    if (!code) continue;
    map.set(code, (map.get(code) ?? 0) + 1);
  }
  const bySourceInvariant = Array.from(map.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);
  return { total: filtered.length, bySourceInvariant };
}
