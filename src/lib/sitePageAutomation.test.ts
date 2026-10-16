import { describe, expect, it } from "vitest";
import { readSitePageAutomationRequest, sitePageAutomationLink, siteFormConditionForSave, siteFormActivationPatch } from "./sitePageAutomation";
const page = "00000000-0000-4000-8000-000000000001";
const form = "00000000-0000-4000-8000-000000000002";
const template = "00000000-0000-4000-8000-000000000003";
const condition = { page_id: page, block_id: form, event: "submitted" as const, delay_minutes: 30 };
describe("page notification reuse", () => {
  it("opens the existing composer with the exact form and template, without an action to send", () => {
    const url = new URL(sitePageAutomationLink(page, form, template), "https://example.invalid");
    expect(url.pathname).toBe("/admin/communication");
    expect(readSitePageAutomationRequest(url.searchParams)).toEqual({ pageId: page, blockId: form, templateId: template, view: "quick" });
    expect([...url.searchParams.keys()]).not.toContain("send");
    expect(readSitePageAutomationRequest(new URLSearchParams("automation_page=wrong"))).toBeNull();
    expect(readSitePageAutomationRequest(new URLSearchParams(`automation_page=${page}&automation_form=wrong`))).toBeNull();
  });
  it("starts a new rule after existing registrations and preserves the boundary on edits", () => {
    const now = "2026-10-17T10:00:00.000Z";
    const saved = siteFormConditionForSave(condition, null, now);
    expect(saved.submissions_from).toBe(now);
    expect(siteFormConditionForSave({ ...condition, delay_minutes: 50 }, saved, "2026-10-18T10:00:00.000Z").submissions_from).toBe(now);
    expect(siteFormConditionForSave({ ...condition, page_id: template }, saved, "2026-10-18T10:00:00.000Z").submissions_from).toBe("2026-10-18T10:00:00.000Z");
  });
  it("rejects malformed delay and leaves existing incomplete reminders on their own contract", () => {
    expect(() => siteFormConditionForSave({ ...condition, delay_minutes: 0.5 }, null, new Date().toISOString())).toThrow();
    const reminder = { ...condition, event: "email_confirmed_incomplete" as const, delay_minutes: 60 };
    expect(siteFormConditionForSave(reminder, null, new Date().toISOString())).toEqual(reminder);
  });
  it("re-enabling does not approve or catch up registrations from a paused period", () => {
    const patch = siteFormActivationPatch({ paused_from_status: "recurring", other: "preserved", site_form_condition: { ...condition, submissions_from: "2026-10-16T10:00:00Z" } }, "2026-10-17T10:00:00Z");
    expect(patch).toMatchObject({ status: "recurring", approval_status: "pending_approval", approved_by: null, approved_at: null, next_run_at: null,
      metadata: { other: "preserved", site_form_condition: { ...condition, submissions_from: "2026-10-17T10:00:00Z" } } });
    expect(patch.metadata).not.toHaveProperty("paused_from_status");
    expect(() => siteFormActivationPatch({}, "2026-10-17T10:00:00Z")).toThrow();
  });
});
