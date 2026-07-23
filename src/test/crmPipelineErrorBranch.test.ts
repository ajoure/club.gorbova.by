import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const worker = readFileSync(
  "supabase/functions/crm-pipeline-automation-worker/index.ts",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/20260723114145_crm_pipeline_automation_error_branch_v9.sql",
  "utf8",
);

describe("CRM automation error branch", () => {
  it("creates an error task only after the final attempt", () => {
    expect(worker).toContain("if (job.attempt_count >= 5)");
    expect(worker).toContain("if (errorRule.error_branch_task_type_id)");
    expect(worker).toContain('pipeline_automation_branch: "error"');
    expect(worker).toContain("error_branch_task_id: errorBranchTaskId");
  });

  it("does not run after a successful fallback", () => {
    expect(worker).toContain("fallback_used: true");
    expect(worker).toContain("continue;");
  });

  it("protects published error branch configuration", () => {
    expect(migration).toContain("crm_pipeline_automation_error_branch_config_chk");
    expect(migration).toContain("trg_crm_pipeline_automation_validate_error_branch");
    expect(migration).toContain("published_automation_version_is_immutable");
  });
});
