import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRM_AUTOMATION_TRIGGER_CATALOG } from "@/lib/crmAutomationTriggerCatalog";

const migration = readFileSync(
  "supabase/migrations/20260723135618_crm_pipeline_automation_deal_left_stage_v14.sql",
  "utf8",
);
const sheet = readFileSync(
  "src/components/admin/deals/PipelineAutomationSheet.tsx",
  "utf8",
);

describe("CRM deal-left-stage trigger", () => {
  it("creates a distinct, old-stage event contract", () => {
    expect(CRM_AUTOMATION_TRIGGER_CATALOG).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "deal_left_stage", availability: "available" }),
      ]),
    );
    expect(migration).toContain("'stage_left'");
    expect(migration).toContain("r.stage_id = OLD.pipeline_stage_id");
    expect(migration).toContain("r.trigger_type = 'deal_left_stage'");
  });

  it("prevents an exit action from being skipped because the deal has already moved", () => {
    expect(migration).toContain("require_same_stage = false");
    expect(sheet).toContain('triggerType === "deal_left_stage" ? false : requireSameStage');
    expect(sheet).toContain("проверка текущей стадии отключена");
  });
});
