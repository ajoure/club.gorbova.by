export interface SiteFormEventCondition { page_id: string; block_id: string; event: "submitted" | "email_confirmed_incomplete"; delay_minutes?: number; submissions_from?: string }
export function readSiteFormEventCondition(value: unknown): SiteFormEventCondition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const c = value as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof c.page_id !== "string" || !uuid.test(c.page_id) || typeof c.block_id !== "string" || !uuid.test(c.block_id)) return null;
  if (c.event === "submitted") {
    if (c.submissions_from !== undefined && (typeof c.submissions_from !== "string" || !Number.isFinite(Date.parse(c.submissions_from)))) return null;
    const cutoff = typeof c.submissions_from === "string" ? { submissions_from: c.submissions_from } : {};
    if (c.delay_minutes === undefined) return { page_id: c.page_id, block_id: c.block_id, event: "submitted", ...cutoff };
    if (typeof c.delay_minutes !== "number" || !Number.isInteger(c.delay_minutes) || c.delay_minutes < 0 || c.delay_minutes > 10080) return null;
    return { page_id: c.page_id, block_id: c.block_id, event: "submitted", delay_minutes: c.delay_minutes, ...cutoff };
  }
  if (c.event === "email_confirmed_incomplete" && typeof c.delay_minutes === "number" && Number.isInteger(c.delay_minutes) && c.delay_minutes >= 15 && c.delay_minutes <= 10080)
    return { page_id: c.page_id, block_id: c.block_id, event: c.event, delay_minutes: c.delay_minutes };
  return null;
}
