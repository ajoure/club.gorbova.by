import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRM_AUTOMATION_TRIGGER_CATALOG } from "@/lib/crmAutomationTriggerCatalog";

const worker = readFileSync(
  "supabase/functions/crm-pipeline-automation-worker/index.ts",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/20260723120944_crm_pipeline_automation_at_datetime_v10.sql",
  "utf8",
);
const sheet = readFileSync(
  "src/components/admin/deals/PipelineAutomationSheet.tsx",
  "utf8",
);

describe("CRM automation one-off date/time trigger", () => {
  it("exposes only a fully backed date/time option", () => {
    expect(CRM_AUTOMATION_TRIGGER_CATALOG).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "at_datetime", availability: "available" }),
      ]),
    );
    expect(CRM_AUTOMATION_TRIGGER_CATALOG).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "weekday", availability: "planned" }),
        expect.objectContaining({ id: "business_day", availability: "planned" }),
      ]),
    );
  });

  it("reuses the canonical date-time picker and saves a timezone-aware local snapshot", () => {
    expect(sheet).toContain('import { DateTimePicker } from "@/components/ui/datetime-picker"');
    expect(sheet).toContain('trigger_type: triggerType');
    expect(sheet).toContain('scheduled_local_at:');
    expect(sheet).toContain('format(scheduledDate, "yyyy-MM-dd")');
  });

  it("has the worker atomically materialize due schedules before claiming jobs", () => {
    expect(worker).toContain('"crm_pipeline_automation_enqueue_due_schedules_v10"');
    expect(worker).toContain("scheduled_rules_fired");
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
    expect(migration).toContain("ON CONFLICT (logical_id, rule_version, deal_id, event_key) DO NOTHING");
    expect(migration).toContain("scheduled_fired_at = now()");
  });

  it("does not enqueue date-time rules from the stage-entry database trigger", () => {
    expect(migration).toContain("AND r.trigger_type = 'deal_entered_stage'");
    expect(migration).toContain("crm_pipeline_automation_schedule_config_v10_chk");
    expect(migration).toContain("crm_pipeline_automation_validate_schedule_v10");
  });
});
