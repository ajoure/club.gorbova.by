import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRM_AUTOMATION_TRIGGER_CATALOG } from "@/lib/crmAutomationTriggerCatalog";

const migration = readFileSync(
  "supabase/migrations/20260723140234_crm_pipeline_automation_payment_received_v16.sql",
  "utf8",
);
const sheet = readFileSync(
  "src/components/admin/deals/PipelineAutomationSheet.tsx",
  "utf8",
);

describe("CRM payment-received trigger", () => {
  it("uses the canonical confirmed payments_v2 event", () => {
    expect(CRM_AUTOMATION_TRIGGER_CATALOG).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "payment_received", availability: "available" }),
      ]),
    );
    expect(migration).toContain("ON public.payments_v2");
    expect(migration).toContain("NEW.status::text <> 'succeeded'");
    expect(migration).toContain("coalesce(NEW.transaction_type::text, 'payment') = 'refund'");
    expect(migration).toContain("concat('payment_received:', NEW.id::text)");
  });

  it("explains the confirmed-payment scope in the existing pipeline editor", () => {
    expect(sheet).toContain('triggerType === "payment_received"');
    expect(sheet).toContain("подтверждённой оплаты по сделке");
  });
});
