import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRM_AUTOMATION_TRIGGER_CATALOG } from "@/lib/crmAutomationTriggerCatalog";

const migration = readFileSync(
  "supabase/migrations/20260723122623_crm_pipeline_automation_after_event_v11.sql",
  "utf8",
);
const sheet = readFileSync(
  "src/components/admin/deals/PipelineAutomationSheet.tsx",
  "utf8",
);

describe("CRM automation after-event trigger", () => {
  it("offers a real delayed-stage event contract instead of a placeholder", () => {
    expect(CRM_AUTOMATION_TRIGGER_CATALOG).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "after_event", availability: "available" }),
      ]),
    );
    expect(migration).toContain("'after_event'");
    expect(migration).toContain("delay_minutes BETWEEN 1 AND 525600");
    expect(migration).toContain("r.trigger_type IN ('deal_entered_stage', 'after_event')");
  });

  it("keeps the existing canonical minutes engine while offering human units", () => {
    expect(sheet).toContain("const DELAY_UNITS =");
    expect(sheet).toContain('value: "weeks"');
    expect(sheet).toContain("Math.round(next * delayUnitMinutes)");
    expect(sheet).toContain("Период отсчитывается с момента входа сделки в эту стадию");
  });
});
