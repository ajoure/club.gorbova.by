export interface AvailabilityView {
  complete: boolean;
  checked: number;
  total: number;
  healthy: number;
  rateLimited: number;
  unknown: number;
  errors: number;
  sourceUnavailable: number;
}

// Recompute from individual results, including historical reports whose
// aggregate incorrectly counted ERROR as healthy. Never fall back to deployed.
export function availabilityView(report: Record<string, unknown> | undefined): AvailabilityView | null {
  const edge = report?.edge_functions as { results?: Array<{ status?: string; checked_at?: string; probe_skipped?: boolean }> } | undefined;
  if (!Array.isArray(edge?.results)) return null;
  const results = edge.results;
  const scan = report?.availability_scan as { complete?: boolean; checked?: number } | undefined;
  const count = (status: string) => results.filter(r => r.status === status).length;
  const unknown = count("UNKNOWN");
  const rateLimited = count("RATE_LIMITED") + results.filter(r => r.status === "ERROR"
    && /rate.?limit/i.test(String((r as { error?: string }).error))).length;
  const errors = results.filter(r => ["ERROR", "CORS_ERROR", "TIMEOUT", "NOT_DEPLOYED"].includes(r.status || "")).length
    - results.filter(r => r.status === "ERROR" && /rate.?limit/i.test(String((r as { error?: string }).error))).length;
  const sourceUnavailable = results.filter(r => r.probe_skipped === true).length;
  return { total: results.length, checked: scan ? Math.max(0, (scan.checked ?? 0) - sourceUnavailable) : results.length - unknown - rateLimited,
    complete: scan?.complete === true || (!scan && unknown === 0 && rateLimited === 0),
    healthy: count("OK"), rateLimited, unknown, errors, sourceUnavailable };
}
