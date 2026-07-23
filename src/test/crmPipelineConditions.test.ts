import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const worker = readFileSync(
  "supabase/functions/crm-pipeline-automation-worker/index.ts",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/20260723110257_crm_pipeline_automation_conditions_v7.sql",
  "utf8",
);

describe("CRM automation conditions", () => {
  it("evaluates AND, OR and predicate NOT before actions", () => {
    expect(worker).toContain('group.logic === "or"');
    expect(worker).toContain("condition.not === true ? !matched : matched");
    expect(worker).toContain("if (!conditionsMatch(rule.conditions, deal))");
  });

  it("skips a non-matching job without treating it as an execution failure", () => {
    expect(worker).toContain('_reason: "conditions_not_met"');
    expect(worker).toContain(
      'status: "skipped", reason: "conditions_not_met"',
    );
  });

  it("uses a server-side whitelist and bounded predicate count", () => {
    expect(migration).toContain("jsonb_array_length(_conditions->'items') NOT BETWEEN 1 AND 10");
    expect(migration).toContain("'responsible_user_id','customer_email','paid_amount','final_price'");
    expect(migration).toContain("crm_pipeline_automation_conditions_shape_chk");
  });
});
