import { readSiteFormEventCondition, type SiteFormEventCondition } from "./siteFormEventCondition";

export const isSiteId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function sitePageAutomationLink(pageId: string, blockId?: string, templateId?: string) {
  const query = new URLSearchParams({ tab: "broadcasts", automation_page: pageId, broadcast_view: blockId ? "quick" : "scheduled" });
  if (blockId) query.set("automation_form", blockId);
  if (templateId) query.set("broadcast_template", templateId);
  return `/admin/communication?${query}`;
}

export function readSitePageAutomationRequest(params: URLSearchParams) {
  const pageId = params.get("automation_page");
  if (!isSiteId(pageId)) return null;
  const blockId = params.get("automation_form");
  const templateId = params.get("broadcast_template");
  if ((blockId && !isSiteId(blockId)) || (templateId && !isSiteId(templateId))) return null;
  return { pageId, blockId, templateId, view: blockId ? "quick" as const : "scheduled" as const };
}

/** A new target starts now; editing the same rule keeps its original boundary. */
export function siteFormConditionForSave(value: SiteFormEventCondition, previous: unknown, now: string) {
  const current = readSiteFormEventCondition(value);
  if (!current) throw new Error("Проверьте страницу, форму и задержку сообщения");
  if (current.event !== "submitted") return current;
  const prior = readSiteFormEventCondition(previous);
  const unchanged = prior?.event === current.event && prior.page_id === current.page_id && prior.block_id === current.block_id;
  return { ...current, submissions_from: unchanged && prior.submissions_from ? prior.submissions_from : now };
}

export function siteFormActivationPatch(metadata: Record<string, unknown>, now: string) {
  const condition = readSiteFormEventCondition(metadata.site_form_condition);
  if (!condition || condition.event !== "submitted" || !Number.isFinite(Date.parse(now))) throw new Error("Проверьте условия регистрации в редакторе сообщения");
  const meta = { ...metadata };
  delete meta.paused_from_status;
  return { status: "recurring", approval_status: "pending_approval", approved_at: null, approved_by: null, next_run_at: null,
    metadata: { ...meta, site_form_condition: { ...condition, submissions_from: now } } };
}
