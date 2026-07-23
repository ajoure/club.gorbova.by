import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRM_AUTOMATION_TRIGGER_CATALOG } from "@/lib/crmAutomationTriggerCatalog";

const migration = readFileSync(
  "supabase/migrations/20260723140021_crm_pipeline_automation_deal_created_v15.sql",
  "utf8",
);
const sheet = readFileSync(
  "src/components/admin/deals/PipelineAutomationSheet.tsx",
  "utf8",
);

describe("CRM deal-created trigger", () => {
  it("is a dedicated INSERT event rather than a stage-move alias", () => {
    expect(CRM_AUTOMATION_TRIGGER_CATALOG).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "deal_created", availability: "available" }),
      ]),
    );
    expect(migration).toContain("AFTER INSERT ON public.orders_v2");
    expect(migration).toContain("'deal_created'");
    expect(migration).toContain("crm_pipeline_automation_enqueue_deal_created");
  });

  it("explains the selected start-stage scope in the existing pipeline editor", () => {
    expect(sheet).toContain('triggerType === "deal_created"');
    expect(sheet).toContain("создании сделки в выбранной стартовой стадии");
  });
});
