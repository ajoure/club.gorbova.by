import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const worker = readFileSync(
  "supabase/functions/crm-pipeline-automation-worker/index.ts",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/20260723112927_crm_pipeline_automation_no_branch_v8.sql",
  "utf8",
);

describe("CRM automation no branch", () => {
  it("creates a follow-up task only for a non-matching condition", () => {
    expect(worker).toContain("if (!conditionsMatch(rule.conditions, deal))");
    expect(worker).toContain("if (rule.no_branch_task_type_id)");
    expect(worker).toContain('pipeline_automation_branch: "no"');
    expect(worker).toContain("no_branch_task_id: noBranchTaskId");
  });

  it("uses the pipeline-specific idempotency key", () => {
    expect(worker).toContain('.eq("pipeline_automation_rule_id", rule.id)');
    expect(worker).toContain("pipeline_automation_rule_id: rule.id");
    expect(migration).toContain("crm_tasks_pipeline_automation_rule_deal_uniq");
    expect(migration).toContain("pipeline_automation_rule_id uuid");
  });

  it("keeps the branch configuration immutable after publication", () => {
    expect(migration).toContain("crm_pipeline_automation_no_branch_config_chk");
    expect(migration).toContain("NEW.no_branch_task_type_id");
    expect(migration).toContain("OLD.no_branch_task_type_id");
  });
});
