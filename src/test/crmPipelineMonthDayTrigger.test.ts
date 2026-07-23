import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRM_AUTOMATION_TRIGGER_CATALOG } from "@/lib/crmAutomationTriggerCatalog";

const worker = readFileSync(
  "supabase/functions/crm-pipeline-automation-worker/index.ts",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/20260723132118_crm_pipeline_automation_month_day_v13.sql",
  "utf8",
);
const sheet = readFileSync(
  "src/components/admin/deals/PipelineAutomationSheet.tsx",
  "utf8",
);

describe("CRM month-day trigger", () => {
  it("has a timezone-aware, idempotent monthly scheduler", () => {
    expect(migration).toContain("recurrence_month_day");
    expect(migration).toContain("recurrence_month_last");
    expect(migration).toContain("interval '1 month - 1 day'");
    expect(migration).toContain("recurrence_month_key IS DISTINCT FROM");
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
    expect(worker).toContain(
      '"crm_pipeline_automation_enqueue_due_month_days_v13"',
    );
  });

  it("uses the unified pipeline editor and makes short-month behavior explicit", () => {
    expect(CRM_AUTOMATION_TRIGGER_CATALOG).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "month_day", availability: "available" }),
      ]),
    );
    expect(sheet).toContain("recurrenceMonthDay");
    expect(sheet).toContain("recurrenceMonthLast");
    expect(sheet).toContain("«Последний день»");
    expect(sheet).toContain("коротких месяцах");
  });
});
