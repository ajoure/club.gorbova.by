export interface SiteFormEventCondition { page_id: string; block_id: string; event: "submitted" }
export function readSiteFormEventCondition(value: unknown): SiteFormEventCondition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const c = value as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return c.event === "submitted" && typeof c.page_id === "string" && uuid.test(c.page_id) && typeof c.block_id === "string" && uuid.test(c.block_id)
    ? { page_id: c.page_id, block_id: c.block_id, event: "submitted" } : null;
}
