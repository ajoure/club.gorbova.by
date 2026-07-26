import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRM_AUTOMATION_TRIGGER_CATALOG } from "@/lib/crmAutomationTriggerCatalog";

const migration = readFileSync("supabase/migrations/20260723140518_crm_pipeline_automation_deal_field_changed_v17.sql", "utf8");
const sheet = readFileSync("src/components/admin/deals/PipelineAutomationSheet.tsx", "utf8");

describe("CRM deal-field-changed trigger", () => {
  it("uses a server-side whitelist and only enqueues a real change", () => {
    expect(CRM_AUTOMATION_TRIGGER_CATALOG).toEqual(expect.arrayContaining([expect.objectContaining({ id: "deal_field_changed", availability: "available" })]));
    expect(migration).toContain("trigger_field IN ('status','currency','is_trial','product_id','tariff_id','responsible_user_id','customer_email','paid_amount','final_price')");
    expect(migration).toContain("IS DISTINCT FROM");
    expect(migration).toContain("trg_crm_pipeline_automation_deal_field_changed");
  });

  it("uses the existing pipeline sheet to select the observed field", () => {
    expect(sheet).toContain("triggerField");
    expect(sheet).toContain("Какое поле отслеживать");
  });
});
