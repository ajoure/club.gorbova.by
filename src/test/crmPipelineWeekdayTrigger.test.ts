import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRM_AUTOMATION_TRIGGER_CATALOG } from "@/lib/crmAutomationTriggerCatalog";

const worker = readFileSync("supabase/functions/crm-pipeline-automation-worker/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260723124201_crm_pipeline_automation_weekday_v12.sql", "utf8");
const sheet = readFileSync("src/components/admin/deals/PipelineAutomationSheet.tsx", "utf8");

describe("CRM weekday trigger", () => {
  it("has a timezone-aware, idempotent worker contract", () => {
    expect(migration).toContain("recurrence_weekdays");
    expect(migration).toContain("recurrence_last_key");
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
    expect(worker).toContain('"crm_pipeline_automation_enqueue_due_weekdays_v12"');
  });
  it("uses the unified pipeline editor for weekday and time selection", () => {
    expect(CRM_AUTOMATION_TRIGGER_CATALOG).toEqual(expect.arrayContaining([expect.objectContaining({ id: "weekday", availability: "available" })]));
    expect(sheet).toContain("const WEEKDAYS =");
    expect(sheet).toContain("recurrenceWeekdays");
    expect(sheet).toContain("recurrenceTime");
  });
});
